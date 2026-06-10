# Zapier Sidecar Setup Guide

This guide walks you through building the JobOps Zapier sidecar — a 2-step Zap that creates a Google Calendar reminder whenever a new row is added to your Jobs tracking spreadsheet.

---

## Why This Is a 2-Step Zap

Zapier's free plan has two hard constraints that shape this design:

- **100 tasks per month** — enough for a light job-search cadence (a few dozen applications/month).
- **2-step Zaps only** — free accounts are limited to one trigger and one action; multi-step Zaps require a paid plan.
- **Webhooks by Zapier is a premium app** — webhook triggers (which Make.com and n8n use freely) require a paid Zapier plan. This rules out the full API-integrated flow on the free tier.

The result is a deliberately lightweight **sidecar** that handles the one job Zapier does well for free: turning a spreadsheet row into a calendar event. Make.com handles the richer webhook-to-API scenario; Zapier handles the human scheduling layer. This contrast is an intentional portfolio talking point — see `docs/AUTOMATION_WORKFLOWS.md` for the full comparison.

---

## Step 1 — Create Your Google Sheet

1. Open [Google Sheets](https://sheets.google.com) and create a new spreadsheet named **JobOps Job Tracker** (or any name you prefer).
2. In the first row, enter these column headers in order — the exact names matter for Zapier field mapping:

   ```
   company | title | job_url | status | follow_up_date | notes
   ```

3. Alternatively, import `workflows/zapier/jobs-sheet-template.csv` directly into Google Sheets:
   - **File → Import → Upload** → select `jobs-sheet-template.csv` → choose **Replace current sheet**.
   - This gives you the correct headers and one sample row.

4. Note the name of the **sheet tab** (by default "Sheet1") — you will need it when configuring the Zap trigger.

---

## Step 2 — Create the Zap

1. Log in to [Zapier](https://zapier.com) and click **Create Zap** (the `+` button).

---

## Step 3 — Configure the Trigger: Google Sheets → New Spreadsheet Row

1. In the trigger step, search for and select **Google Sheets**.
2. Choose the event **New Spreadsheet Row** and click **Continue**.
3. Connect your Google account if you have not already.
4. In the **Trigger** settings:
   - **Spreadsheet** — select your **JobOps Job Tracker** spreadsheet.
   - **Worksheet** — select **Sheet1** (or whichever tab you named it).
5. Click **Test trigger**. Zapier will pull in the sample row from the sheet. Confirm you can see the `company`, `title`, `job_url`, `status`, `follow_up_date`, and `notes` fields in the sample data.
6. Click **Continue**.

---

## Step 4 — Configure the Action: Google Calendar → Create Detailed Event

1. In the action step, search for and select **Google Calendar**.
2. Choose the event **Create Detailed Event** and click **Continue**.
3. Connect your Google account (the same one or a different one — whichever calendar you want the reminders on).
4. Map the fields as follows:

   | Calendar field | Value to map |
   |----------------|-------------|
   | **Summary** | Type `Follow up: ` then insert the dynamic field `title`, then type ` @ `, then insert `company`. The result should read like: `Follow up: AI Engineer @ Acme`. |
   | **Start Date & Time** | Map to `follow_up_date` from the trigger. Zapier accepts dates in YYYY-MM-DD format; the template column uses this format. **Note:** a date-only value creates an all-day (midnight) event. To get a timed reminder instead, append a time when you fill the spreadsheet cell — e.g. `2026-06-17 09:00`. |
   | **Description** | Type `Notes: ` then insert `notes`, then a newline, then `Job URL: ` then insert `job_url`. |
   | **Calendar** | Select whichever Google Calendar you want the event added to. |

5. Leave other fields (duration, location, guests) blank.
6. Click **Continue**.

---

## Step 5 — Test and Activate

1. Click **Test action**. Zapier will create a test event in your Google Calendar using the sample row data.
2. Open Google Calendar and confirm the event was created with the correct summary, date, and description.
3. If the event looks correct, click **Publish Zap** (or **Turn on Zap**) to activate it.

From this point, every time you add a new row to your Jobs spreadsheet, Zapier will automatically create a follow-up reminder in Google Calendar.

Save a screenshot of the completed Zap (both trigger and action steps shown as connected and active) to `docs/design/phase7/zapier-zap.png`.

---

## Free Tier Note

Zapier's free plan allows **100 tasks per month** (one task = one Zap run). At a typical job-search cadence of 2–5 new applications per day, 100 tasks covers 20–50 days of tracking before the monthly limit is reached — adequate for light use. If you exceed 100 tasks/month, Zapier pauses the Zap until the next billing cycle.

The free plan supports **2-step Zaps only** (one trigger + one action). Google Sheets and Google Calendar are both standard free apps. No premium features are used.
