# hook-runner - Generic Webhook Scheduler

A simple and powerful application for scheduling HTTP POST requests (webhooks) based on cron expressions, managed through an intuitive web-based user interface. Built for deployment on Deno Deploy, it leverages Deno KV for persistent storage of your webhook configurations.

## ✨ Features

* **Web-based UI:** Easily add, edit, and delete scheduled webhooks through a user-friendly interface.
* **Cron-based Scheduling:** Define webhook trigger times using standard cron expressions (e.g., `0 0 * * *` for daily at midnight UTC).
* **Persistent Storage:** Webhook configurations are stored securely using Deno KV, ensuring data survives deployments and restarts.
* **Dynamic Scheduling:** A single Deno.cron job dynamically manages all webhooks from Deno KV, preventing "top-level only" errors during deployment.
* **HTTP Basic Authentication:** Protect your UI with a simple username and password.
* **Deno Deploy Integration:** Built specifically for Deno Deploy, with an integrated "Redeploy" button to refresh the application state after updates.
* **Input Robustness:** Automatically trims leading/trailing spaces from user inputs (name, URL, schedule) to prevent common parsing errors.

## 🚀 Technologies Used

* **Deno:** A secure runtime for JavaScript and TypeScript.
* **Deno KV:** Deno's built-in key-value database for persistent data storage.
* **Deno Deploy:** The platform for deploying Deno applications to the edge.
* **croner:** A robust cron parser library for Deno.
* **HTML & Tailwind CSS:** For the simple and responsive web interface.

## ⚙️ Setup and Deployment (on Deno Deploy)

### 1. Project Structure

Ensure your project has the following structure:

```
your-project-root/
├── main.ts             <-- Your main Deno application logic
└── static/
└── index.html      <-- The web-based UI
```

### 2. Environment Variables

Set the following environment variables in your Deno Deploy project settings:

* `WEBHOOK_ADMIN_USERNAME`: Your desired username for UI access.
* `WEBHOOK_ADMIN_PASSWORD`: Your desired password for UI access.
* `DD_PROJECT_ID`: Your Deno Deploy Project ID. This is typically found in the URL of your Deno Deploy project dashboard (e.g., `https://dash.deno.com/projects/<YOUR_PROJECT_ID>`).
* `DD_ACCESS_TOKEN`: A Deno Deploy Access Token with `Read: projects` and `Deploy: projects` permissions. You can generate one in your Deno Deploy account settings under "Access Tokens".

**Note:** If `WEBHOOK_ADMIN_USERNAME` or `WEBHOOK_ADMIN_PASSWORD` are not set, the UI will not be password protected. If `DD_PROJECT_ID` or `DD_ACCESS_TOKEN` are not set, the "Trigger Project Redeploy" button will not function.

### 3. Deploy to Deno Deploy

1.  Connect your GitHub repository to Deno Deploy.
2.  Configure your project to deploy `main.ts` as the entry point.
3.  Ensure the environment variables listed above are correctly set.
4.  Trigger a deployment.

## 👨‍💻 Usage

1.  **Access the UI:** Once deployed, navigate to your Deno Deploy project's URL. You will be prompted for the `WEBHOOK_ADMIN_USERNAME` and `WEBHOOK_ADMIN_PASSWORD` if set.
2.  **Add a Webhook:**
    * Enter a `Name` for your webhook (e.g., "Daily Report Trigger").
    * Provide the `URL` of the endpoint that should receive the POST request.
    * Enter the `Cron Schedule` in UTC (e.g., `0 0 * * *` for daily at midnight). You can use tools like [crontab.guru](https://crontab.guru/) to help formulate your cron expressions.
    * Click "Add Webhook".
3.  **Edit/Delete Webhooks:**
    * Existing webhooks will be listed below the "Add New Webhook" section.
    * Click "Edit" to modify a webhook's details using the modal.
    * Click "Delete" to remove a webhook.
4.  **Trigger Project Redeploy:**
    * If you make changes to your backend code (`main.ts`) or need to ensure cron jobs are re-initialized, click the "Trigger Project Redeploy" button. This will initiate a new deployment on Deno Deploy.

## ⚠️ Important Notes

* **Cron Timezone:** All cron schedules are interpreted in **UTC**.
* **Error Handling:** The application logs errors related to cron parsing and webhook pings to your Deno Deploy logs. Monitor these for any issues.
* **Security:** Basic Auth provides a simple layer of security. For highly sensitive applications, consider more robust authentication mechanisms.

---

Feel free to customize this README further with more specific details, screenshots, or any other information relevant to your project!