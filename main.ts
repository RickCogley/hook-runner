import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { Kv } from "https://deno.land/x/fresh@1.6.0/server.ts"; // Not really for fresh, but an easy way to get Kv type
import { decode as decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts"; // For basic auth decoding

interface Webhook {
  id: string; // UUID for unique identification
  name: string;
  url: string;
  schedule: string; // Cron schedule string
  createdAt: string;
}

const kv = await Deno.openKv(); // Open Deno KV database

// --- Configuration for HTTP Basic Auth ---
// These should be set as environment variables in Deno Deploy
const USERNAME = Deno.env.get("WEBHOOK_AUTH_USERNAME");
const PASSWORD = Deno.env.get("WEBHOOK_AUTH_PASSWORD");

if (!USERNAME || !PASSWORD) {
  console.warn("WARNING: WEBHOOK_AUTH_USERNAME or WEBHOOK_AUTH_PASSWORD not set. The UI will not be password protected!");
}

// Function to handle HTTP Basic Authentication
function authenticate(req: Request): Response | null {
  if (!USERNAME || !PASSWORD) {
    return null; // No authentication configured
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

  const encodedCreds = authHeader.substring(6); // Remove "Basic "
  const decodedCreds = new TextDecoder().decode(decodeBase64(encodedCreds));
  const [reqUsername, reqPassword] = decodedCreds.split(":");

  if (reqUsername === USERNAME && reqPassword === PASSWORD) {
    return null; // Authentication successful
  } else {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Webhook Scheduler"',
      },
    });
  }
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
      method: 'POST', // Most webhooks expect POST requests
      // You might add headers here if specific webhooks require them (e.g., Content-Type)
      // headers: { 'Content-Type': 'application/json' },
      // body: JSON.stringify({ message: "Scheduled trigger" }) // If a body is needed
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
    const webhook = entry.value;
    const cronName = `webhook_job_${webhook.id}`; // Unique name for cron dashboard

    Deno.cron(cronName, webhook.schedule, async () => {
      console.log(`Triggering scheduled webhook: ${webhook.name} (ID: ${webhook.id})`);
      await pingWebhook(webhook.url, webhook.name);
    });
    console.log(`  - Registered cron job: "${webhook.name}" (ID: ${webhook.id}) with schedule "${webhook.schedule}"`);
  }
  console.log("Finished setting up Deno cron jobs.");
}

// Call this once on startup to register all cron jobs
setupCronJobs();

// --- HTTP Server for UI and KV Management ---
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Apply basic authentication to all routes that are not static assets
  // (Assuming static assets won't be exposed by Deno Deploy's default serving)
  // For simplicity, we apply it to everything, then serve static assets if authenticated.
  const authResponse = authenticate(req);
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
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  // API to list all webhooks
  if (url.pathname === "/hooks" && req.method === "GET") {
    const webhooks: Webhook[] = [];
    const iter = kv.list<Webhook>({ prefix: ["webhooks"] });
    for await (const entry of iter) {
      webhooks.push(entry.value);
    }
    return new Response(JSON.stringify(webhooks), {
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
      const newWebhook: Webhook = {
        id,
        name: String(name),
        url: String(url),
        schedule: String(schedule),
        createdAt: new Date().toISOString(),
      };

      await kv.set(["webhooks", id], newWebhook);

      return new Response(JSON.stringify(newWebhook), {
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

  // Fallback for unknown routes
  return new Response("Not Found", { status: 404 });
}

console.log("HTTP server starting...");
serve(handler);