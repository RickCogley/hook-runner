// --- main.ts (Latest Corrected Version for croner module API and minuteAgo definition) ---

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { Cron } from "https://deno.land/x/croner@8.1.2/dist/croner.js"; // Updated import for croner module

interface Webhook {
  id: string; // UUID for unique identification
  name: string;
  url: string;
  schedule: string; // Cron schedule string
  createdAt: string;
}

const kv = await Deno.openKv(); // Open Deno KV database

// --- SINGLE TOP-LEVEL CRON JOB FOR DYNAMIC SCHEDULING ---
// This single cron job will run periodically (every minute) and check all webhooks from KV
// to determine if they should be triggered based on their schedule.
console.log("Registering a single top-level Deno cron job to manage dynamic webhooks...");
Deno.cron("webhook-kv-scheduler", "* * * * *", async () => { // Runs every minute in UTC
  console.log(`[webhook-kv-scheduler] Running at ${new Date().toISOString()}`);
  const now = new Date(); // Current time for schedule comparison (in UTC)
  const oneMinute = 60 * 1000; // One minute in milliseconds
  const minuteAgo = new Date(now.getTime() - oneMinute); // CORRECTED: Defined minuteAgo here

  const iter = kv.list<Webhook>({ prefix: ["webhooks"] });
  for await (const entry of iter) {
    const hook = entry.value;
    try {
      const cron = new Cron(hook.schedule);

      // Using cron.nextRun() to get the next scheduled date
      const nextFromMinuteAgo = cron.nextRun(minuteAgo);

      // Check if the next scheduled time falls within the current minute (within a 5-second tolerance)
      // This helps trigger the webhook if it's due in the current minute.
      if (nextFromMinuteAgo && Math.abs(now.getTime() - nextFromMinuteAgo.getTime()) < 5 * 1000) {
        // Prevent double-triggering within the same minute
        const lastTriggeredKey = ["last_triggered", hook.id];
        const lastTriggeredEntry = await kv.get<string>(lastTriggeredKey);

        let hasTriggeredThisMinute = false;
        if (lastTriggeredEntry.value) {
            const lastTriggeredDate = new Date(lastTriggeredEntry.value);
            // Compare year, month, day, hour, and minute to ensure it's not already triggered in *this* minute
            if (lastTriggeredDate.getUTCFullYear() === now.getUTCFullYear() &&
                lastTriggeredDate.getUTCMonth() === now.getUTCMonth() &&
                lastTriggeredDate.getUTCDate() === now.getUTCDate() &&
                lastTriggeredDate.getUTCHours() === now.getUTCHours() &&
                lastTriggeredDate.getUTCMinutes() === now.getUTCMinutes()) {
                hasTriggeredThisMinute = true;
            }
        }

        if (!hasTriggeredThisMinute) {
          console.log(`[webhook-kv-scheduler] Triggering scheduled webhook: ${hook.name} (ID: ${hook.id}) due at ${nextFromMinuteAgo.toISOString()}`);
          await pingWebhook(hook.url, hook.name);
          await kv.set(lastTriggeredKey, now.toISOString()); // Mark as triggered now (in UTC)
        } else {
          console.log(`[webhook-kv-scheduler] Webhook ${hook.name} (ID: ${hook.id}) already triggered this minute.`);
        }
      }

    } catch (parseError) {
      console.error(`[webhook-kv-scheduler] Error parsing cron schedule for ${hook.name} (ID: ${hook.id}): ${parseError.message}`);
    }
  }
  console.log(`[webhook-kv-scheduler] Finished run.`);
});

// --- Configuration from Environment Variables ---
const ADMIN_USERNAME = Deno.env.get("WEBHOOK_ADMIN_USERNAME");
const ADMIN_PASSWORD = Deno.env.get("WEBHOOK_ADMIN_PASSWORD"); // Corrected variable name to match your preference
const DD_PROJECT_ID = Deno.env.get("DD_PROJECT_ID");
const DD_ACCESS_TOKEN = Deno.env.get("DD_ACCESS_TOKEN");

// --- Global variables for asset metadata ---
const ENTRY_POINT_URL = `main.ts`;
const REPO_RAW_BASE_URL = `https://raw.githubusercontent.com/eSolia/hook-runner/refs/heads/main/`;
const INDEX_HTML_RAW_URL = `${REPO_RAW_BASE_URL}static/index.html`;

// --- Utility function to calculate SHA-256 hash ---
async function sha256(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hexHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `sha256:${hexHash}`;
}

// --- Environment Variable Warnings ---
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
                envVars: {}, // Environment variables are not usually included in the deploy payload directly
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

// --- Function to update a webhook ---
async function updateWebhook(id: string, updatedData: Partial<Webhook>): Promise<Webhook | null> {
    const key = ["webhooks", id];
    const entry = await kv.get<Webhook>(key);

    if (!entry.value) {
        return null; // Webhook not found
    }

    const currentHook = entry.value;
    const newHook: Webhook = {
        ...currentHook,
        ...updatedData,
        id: currentHook.id,
        createdAt: currentHook.createdAt,
    };

    await kv.set(key, newHook);
    return newHook;
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

  // API to update a webhook
  if (url.pathname.startsWith("/hooks/") && req.method === "PUT") {
    const id = url.pathname.split("/").pop();
    if (!id) {
      return new Response("Webhook ID missing", { status: 400 });
    }

    try {
      const data = await req.json();
      const updatedHook = await updateWebhook(id, data);

      if (!updatedHook) {
        return new Response("Webhook not found", { status: 404 });
      }

      return new Response(JSON.stringify(updatedHook), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error updating webhook:", error);
      return new Response(`Failed to update webhook: ${error.message}`, { status: 500 });
    }
  }

  // API to delete a webhook
  if (url.pathname.startsWith("/hooks/") && req.method === "DELETE") {
    const id = url.pathname.split("/").pop();
    if (!id) {
      return new Response("Webhook ID missing", { status: 400 });
    }

    try {
      await kv.delete(["webhooks", id]);
      // CORRECTED: Return null body for 204 No Content status
      return new Response(null, { status: 204 });
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