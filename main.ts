// Add a new global variable to store the content of index.html
let INDEX_HTML_CONTENT: string | null = null; // To store the content as a string

// --- Initialization Function to get asset sizes and hashes by reading local files ---
async function initializeAssetMetadata() {
  console.log("Reading deployed asset metadata (e.g., index.html size and hash)...");
  try {
    const filePath = join(Deno.cwd(), "static", "index.html");
    const fileContentUint8 = await Deno.readFile(filePath);

    // Store the content as a string (assuming index.html is UTF-8 text)
    INDEX_HTML_CONTENT = new TextDecoder().decode(fileContentUint8);
    INDEX_HTML_SIZE = fileContentUint8.byteLength;
    INDEX_HTML_SHA256 = await sha256(fileContentUint8);

    console.log(`index.html size: ${INDEX_HTML_SIZE} bytes`);
    console.log(`index.html SHA-256: ${INDEX_HTML_SHA256}`);
  } catch (error) {
    console.error("Error reading index.html locally or calculating hash:", error);
    INDEX_HTML_SIZE = null;
    INDEX_HTML_SHA256 = null;
    INDEX_HTML_CONTENT = null; // Also reset content on error
  }
}

// --- Function to trigger Deno Deploy redeploy ---
async function triggerDenoDeployRedeploy(): Promise<boolean> {
    if (!DD_PROJECT_ID || !DD_ACCESS_TOKEN) {
        console.error("Cannot trigger redeploy: Project ID or Access Token is missing.");
        return false;
    }
    // Ensure content is available before attempting to deploy
    if (INDEX_HTML_CONTENT === null) {
        console.error("Cannot trigger redeploy: index.html content is not loaded.");
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
                        content: INDEX_HTML_CONTENT, // <--- KEY CHANGE: Send the content
                        encoding: "utf-8",           // <--- Specify encoding
                    },
                },
                branch: 'main', // Assuming you are always deploying from 'main'
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