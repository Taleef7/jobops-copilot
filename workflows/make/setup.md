# Make.com Scenario Setup Guide

This guide walks you through importing the `job-intake.blueprint.json` scenario into Make.com and wiring it to the live JobOps API. Follow every step in order.

---

## Prerequisites

- A free [Make.com](https://www.make.com) account (no paid plan required; custom webhooks and HTTP modules are available on the free tier).
- The value of `N8N_WEBHOOK_SECRET` from `apps/api/.env` (or ask the project maintainer). This is the shared secret the API uses to authenticate incoming webhook requests via the `X-N8N-Webhook-Secret` header.
- An email account you can connect to Make (Gmail, Outlook, or any SMTP-compatible account).

---

## Step 1 — Import the Blueprint

1. Log in to [Make.com](https://www.make.com) and open **Scenarios** from the left sidebar.
2. Click **Create a new scenario** (the blue `+` button in the top-right corner).
3. Close the module picker that appears — you will import the blueprint instead of adding modules manually.
4. Click the **three-dots menu** (⋮) in the bottom toolbar of the scenario canvas and select **Import Blueprint**.
5. In the file picker that opens, navigate to and select `workflows/make/exports/job-intake.blueprint.json` from this repository.
6. Make will draw three connected modules on the canvas: **Custom webhook → HTTP → Email**.

---

## Step 2 — Fix Module 1: Custom Webhook

1. Click the **Custom webhook** module (module 1, the leftmost circle).
2. In the webhook panel, click **Add** next to the Webhook field to create a new webhook named `JobOps job intake` (the name is pre-filled from the blueprint).
3. Make will generate a unique webhook URL for this scenario. Copy it — you will need it for the test curl later.
4. Click **Save**.

---

## Step 3 — Fix Module 2: HTTP (API Call)

1. Click the **HTTP** module (module 2, the middle circle).
2. Locate the **Headers** section. Find the header named `X-N8N-Webhook-Secret`.
3. Replace the placeholder value `REPLACE_WITH_N8N_WEBHOOK_SECRET` with the actual secret from `apps/api/.env`.
4. All other settings (URL, method, body) are already configured correctly from the blueprint. Verify the URL reads `https://jobops-api.azurewebsites.net/api/n8n/job-intake` and the method is `POST`.
5. Click **OK**.

---

## Step 4 — Fix Module 3: Email (Notification)

1. Click the **Email** module (module 3, the rightmost circle).
2. Click the **Connection** field and select or create a connection to your email account. Make supports Gmail, Outlook/Microsoft 365, and custom SMTP.
3. In the **To** field, replace `REPLACE_WITH_YOUR_EMAIL` with your actual email address.
4. The subject and body use dynamic values from the earlier modules (`{{1.title}}`, `{{1.company}}`, `{{2.fit_status}}`, `{{2.notification}}`). Leave those as-is.
5. Click **OK**.

---

## Step 5 — Get Your Webhook URL

If you did not copy the URL in Step 2, retrieve it now:

1. Click the **Custom webhook** module.
2. The webhook URL is displayed in the module panel under the webhook name. It looks like `https://hook.eu2.make.com/abcdef123456`.
3. Copy this URL — it is your Make scenario's public entry point.

---

## Step 6 — Test the Scenario

Before running the test, click **Run once** in the bottom toolbar so Make listens for a single incoming request.

Then, in a terminal, send a test payload using curl:

```bash
curl -X POST "<MAKE_WEBHOOK_URL>" \
  -H "Content-Type: application/json" \
  -d '{"company":"Acme","title":"AI Engineer","description_text":"Build LLM apps with Python and Azure.","job_url":"https://example.com/job/1"}'
```

Replace `<MAKE_WEBHOOK_URL>` with the URL you copied in Step 5.

---

## Expected Result

The scenario should execute all three modules:

1. **Custom webhook** — receives the payload, extracts `company`, `title`, `description_text`, `job_url`.
2. **HTTP** — POSTs to the JobOps API, which creates the job record, parses the description, and runs fit scoring. The API response includes `fit_status` (e.g. `strong_fit`) and `notification` (a human-readable summary string).
3. **Email** — sends you an email with the subject `JobOps: AI Engineer @ Acme processed` and a body showing the fit status and notification text.

In Make's execution history you will see green checkmarks on all three modules. After a successful test run, click **Save** and then **Activate** the scenario.

Save a screenshot of the completed scenario canvas (all three modules connected with green execution bubbles) to `docs/design/phase7/make-scenario.png`.

---

## Free Tier Note

Make.com's free plan includes **1,000 operations per month**. Each scenario run consumes one operation per module execution — so this three-module scenario costs 3 operations per job submitted. That allows approximately 333 job intakes per month on the free tier.

Custom webhooks (the `gateway:CustomWebHook` module) and HTTP requests (the `http:ActionSendData` module) are both available on the free tier. No upgrade is required to run this scenario.
