import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

interface Webhook {
  id: string; // UUID for unique identification
  name: string;
  url: string;
  schedule: string; // Cron schedule string
  createdAt: string;
}

const kv = await Deno.openKv(); // Open Deno KV database

// --- Configuration from Environment Variables ---
const ADMIN_USERNAME = Deno.env.get("WEBHOOK_ADMIN_USERNAME");
const ADMIN_PASSWORD = Deno.env.get("WEBHOOK_ADMIN_PASSWORD");
// UPDATED: Deno Deploy Project ID and Access Token for redeployment
const DD_PROJECT_ID = Deno.env.get("DD_PROJECT_ID"); // Changed from DENO_DEPLOY_PROJECT_ID
const DD_ACCESS_TOKEN = Deno.env.get("DD_ACCESS_TOKEN"); // Changed from DENO_DEPLOY_ACCESS_TOKEN


if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  console.warn("WARNING: WEBHOOK_ADMIN_USERNAME or WEBHOOK_ADMIN_PASSWORD environment variables are not set. The UI will not be password protected!");
}

if (!DD_PROJECT_ID || !DD_ACCESS_TOKEN) { // Updated check
    console.warn("WARNING: DD_PROJECT_ID or DD_ACCESS_TOKEN environment variables are not set. Automated redeployments will not work!");
}


// --- Generic Webhook Pinger Function ---
async function pingWebhook(webhookUrl: string, name: string) {
  if (!webhookUrl) {
    console.warn(`Skipping webhook "${name}": URL not provided.`);
    return;
  }
  console.log(`Attempting to ping webhook: "${name}" at ${new Date().toISOString()}`);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      // You can add headers here if needed, e.g., for specific webhook services
      // headers: { 'Content-Type': 'application/json' },
      // body: JSON.stringify({ event: 'scheduled_build' }), // Example body
    });

    if (response.ok) {
      console.log(`Successfully pinged "${name}" webhook. Status: ${response.status}`);
    } else {
      console.error(`Failed to ping "${name}" webhook. Status: ${response.status}, Response: ${await response.text()}`);
    }
  } catch (error) {
    console.error(`Error pinging "${name}" webhook:`, error);
  }
}

// --- Deno.cron Job Registration ---
async function setupCronJobs() {
  console.log("Setting up Deno cron jobs from KV...");
  const iter = kv.list<Webhook>({ prefix: ["webhooks"] });
  for await (const entry of iter) {
    const hook = entry.value;
    const cronName = `generic_webhook_${hook.id}`;

    Deno.cron(cronName, hook.schedule, async () => {
      console.log(`Triggering scheduled webhook: ${hook.name} (ID: ${hook.id})`);
      await pingWebhook(hook.url, hook.name);
    });
    console.log(`  - Registered cron job: "${hook.name}" (ID: ${hook.id}) with schedule "${hook.schedule}"`);
  }
  console.log("Finished setting up Deno cron jobs.");
}

// Call this once on startup to register all cron jobs
setupCronJobs();

// --- HTTP Basic Authentication Middleware ---
function basicAuth(req: Request): Response | null {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    // If auth is not configured, allow access
    return null;
  }

  const authHeader = req.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Webhook Scheduler"',
      },
    });
  }

  const encodedCreds = authHeader.substring(6); // "Basic ".length = 6
  const decodedCreds = atob(encodedCreds);
  const [username, password] = decodedCreds.split(":");

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    return null; // Authentication successful, proceed
  } else {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Webhook Scheduler"',
      },
    });
  }
}

// --- Function to trigger Deno Deploy redeploy ---
async function triggerDenoDeployRedeploy(): Promise<boolean> {
    if (!DD_PROJECT_ID || !DD_ACCESS_TOKEN) {
        console.error("Cannot trigger redeploy: Project ID or Access Token is missing.");
        return false;
    }

    const deployUrl = `https://api.deno.com/v1/projects/${DD_PROJECT_ID}/deployments`;
    console.log(`Attempting to trigger redeploy for project ID: ${DD_PROJECT_ID}`);

    const entryPoint = `https://raw.githubusercontent.com/eSolia/hook-runner/refs/heads/main/main.ts`;

    // Define the base URL for raw content from your repository
    const repoRawBaseUrl = `https://raw.githubusercontent.com/eSolia/hook-runner/refs/heads/main/`;

    try {
        const response = await fetch(deployUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${DD_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                entryPointUrl: entryPoint,
                // NEW: Define assets
                assets: {
                    // Map the local path in your deployment ('static/index.html')
                    // to its raw URL in the GitHub repository.
                    "static/index.html": {
                        path: "static/index.html",
                        url: `${repoRawBaseUrl}static/index.html`,
                        // You can also provide the content (instead of URL) if you want,
                        // or a SHA-256 hash of the content for verification.
                        // For simplicity, just providing the URL is usually enough.
                    },
                    // Add other assets here if you had more files in your 'static' folder
                    // "static/styles.css": { path: "static/styles.css", url: `${repoRawBaseUrl}static/styles.css` },
                    // "static/script.js": { path: "static/script.js", url: `${repoRawBaseUrl}static/script.js` },
                },
                // You can also specify a branch if needed, though entryPointUrl implies it
                branch: 'main', // Explicitly specify the branch for clarity
            }),
        });

        if (response.ok) {
            console.log("Deno Deploy redeploy request sent successfully.");
            return true;
        } else {
            const errorText = await response.text();
            console.error(`Failed to trigger Deno Deploy redeploy. Status: ${response.status}, Response: ${errorText}`);
            return false;
        }
    } catch (error) {
        console.error("Error during Deno Deploy redeploy API call:", error);
        return false;
    }
}


// --- HTTP Server for UI and KV Management ---
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Apply basic authentication to all routes (except perhaps public assets if you had any)
  const authResponse = basicAuth(req);
  if (authResponse) {
    return authResponse;
  }

  // Serve static HTML file
  if (url.pathname === "/") {
    const filePath = join(Deno.cwd(), "static", "index.html");
    try {
      const file = await Deno.readFile(filePath);
      return new Response(file, {
        headers: { "Content-Type": "text/html" },
      });
    } catch (error) {
      console.error("Error serving index.html:", error);
      return new Response("Internal Server Error: Could not load UI.", { status: 500 });
    }
  }

  // API to list all webhooks
  if (url.pathname === "/hooks" && req.method === "GET") {
    const hooks: Webhook[] = [];
    const iter = kv.list<Webhook>({ prefix: ["webhooks"] });
    for await (const entry of iter) {
      hooks.push(entry.value);
    }
    return new Response(JSON.stringify(hooks), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // API to add a new webhook
  if (url.pathname === "/hooks" && req.method === "POST") {
    try {
      const data = await req.json();
      const { name, url, schedule } = data;

      if (!name || !url || !schedule) {
        return new Response("Missing required fields: name, url, schedule", { status: 400 });
      }

      const id = crypto.randomUUID();
      const newHook: Webhook = {
        id,
        name: String(name),
        url: String(url),
        schedule: String(schedule),
        createdAt: new Date().toISOString(),
      };

      await kv.set(["webhooks", id], newHook);

      return new Response(JSON.stringify(newHook), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error adding webhook:", error);
      return new Response(`Failed to add webhook: ${error.message}`, { status: 500 });
    }
  }

  // API to delete a webhook
  if (url.pathname.startsWith("/hooks/") && req.method === "DELETE") {
    const id = url.pathname.split("/").pop(); // Get the ID from the URL
    if (!id) {
      return new Response("Webhook ID missing", { status: 400 });
    }

    try {
      await kv.delete(["webhooks", id]);
      return new Response("Webhook deleted", { status: 204 });
    } catch (error) {
      console.error("Error deleting webhook:", error);
      return new Response(`Failed to delete webhook: ${error.message}`, { status: 500 });
    }
  }

  // NEW: API endpoint to trigger redeploy
  if (url.pathname === "/redeploy" && req.method === "POST") {
    console.log("Redeploy endpoint hit.");
    const success = await triggerDenoDeployRedeploy();
    if (success) {
        return new Response("Redeploy triggered successfully.", { status: 200 });
    } else {
        return new Response("Failed to trigger redeploy.", { status: 500 });
    }
  }

  // Fallback for unknown routes
  return new Response("Not Found", { status: 404 });
}

console.log("HTTP server starting...");
serve(handler);