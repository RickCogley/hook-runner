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
const DD_PROJECT_ID = Deno.env.get("DD_PROJECT_ID");
const DD_ACCESS_TOKEN = Deno.env.get("DD_ACCESS_TOKEN");

// --- Global variables for asset metadata (no longer populated at startup for index.html) ---
// We will fetch index.html content dynamically when needed
const ENTRY_POINT_URL = `main.ts`; // <--- CHANGED THIS LINE
const REPO_RAW_BASE_URL = `https://raw.githubusercontent.com/eSolia/hook-runner/refs/heads/main/`;
const INDEX_HTML_RAW_URL = `${REPO_RAW_BASE_URL}static/index.html`;

// --- Utility function to calculate SHA-256 hash (still useful for general purpose, but not for API asset directly) ---
async function sha256(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hexHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `sha256:${hexHash}`;
}

// --- Initialization Function (now only sets up cron jobs, no local file reading) ---
async function initializeApp() {
  console.log("Initializing application...");
  setupCronJobs();
  console.log("Application initialization complete.");
}

// Call initialization functions
await initializeApp(); // Call the simpler init function

if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  console.warn("WARNING: WEBHOOK_ADMIN_USERNAME or WEBHOOK_ADMIN_PASSWORD environment variables are not set. The UI will not be password protected!");
}

if (!DD_PROJECT_ID || !DD_ACCESS_TOKEN) {
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


// --- HTTP Basic Authentication Middleware ---
function basicAuth(req: Request): Response | null {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
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

  const encodedCreds = authHeader.substring(6);
  const decodedCreds = atob(encodedCreds);
  const [username, password] = decodedCreds.split(":");

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    return null;
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

    // Fetch index.html content dynamically
    let indexHtmlContent: string;
    try {
        console.log(`Fetching index.html content from: ${INDEX_HTML_RAW_URL}`);
        const response = await fetch(INDEX_HTML_RAW_URL);
        if (!response.ok) {
            throw new Error(`Failed to fetch index.html: ${response.statusText}`);
        }
        indexHtmlContent = await response.text();
        console.log("index.html content fetched successfully.");
    } catch (error) {
        console.error("Error fetching index.html for redeploy:", error);
        return false;
    }

    const deployUrl = `https://api.deno.com/v1/projects/${DD_PROJECT_ID}/deployments`;
    console.log(`Attempting to trigger redeploy for project ID: ${DD_PROJECT_ID}`);

    try {
        const response = await fetch(deployUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${DD_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                entryPointUrl: ENTRY_POINT_URL,
                assets: {
                    "static/index.html": {
                        kind: "file",
                        content: indexHtmlContent,
                        encoding: "utf-8",
                    },
                },
                envVars: {},
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

  // Apply basic authentication to all routes
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

  // API endpoint to trigger redeploy
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