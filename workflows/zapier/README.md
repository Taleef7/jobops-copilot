# Zapier Companion Sidecar

This directory contains a **ready-to-build** Zapier sidecar: a 2-step Zap that watches a Google Sheet of tracked job applications and creates a Google Calendar follow-up reminder for each new row.

## What the Zap Does

```
Google Sheets: New Spreadsheet Row  →  Google Calendar: Create Detailed Event
```

1. **Trigger (Google Sheets — New Spreadsheet Row)** — fires whenever you add a new row to your Jobs tracking sheet, picking up `company`, `title`, `job_url`, `status`, `follow_up_date`, and `notes`.
2. **Action (Google Calendar — Create Detailed Event)** — creates a calendar event with the summary `Follow up: <title> @ <company>`, the date from `follow_up_date`, and a description combining `notes` and `job_url`.

## Files

| File | Purpose |
|------|---------|
| `jobs-sheet-template.csv` | Google Sheets template with the required column headers and one sample row |
| `setup.md` | Click-by-click guide to create the sheet, build the Zap, and activate it |

## Status

The Zap is **ready to build** in the Zapier GUI — no import mechanism exists for Zaps, so the guide walks through creation step by step. It is not a live running Zap. The maintainer follows `setup.md`, tests the Zap, and saves a screenshot to `docs/design/phase7/zapier-zap.png` after activation.

## Free Tier Constraints That Shaped This Design

Zapier's free plan has hard limits: **100 tasks/month**, **2-step Zaps only** (one trigger + one action), and **Webhooks by Zapier is a premium app** (webhook triggers require a paid plan).

These constraints rule out a webhook-to-API flow on Zapier's free tier. The sidecar is therefore intentionally narrow — it covers the human scheduling layer (sheet row to calendar reminder) rather than the API-integrated intake path. Make.com handles the richer webhook scenario for free; this Zap complements it.

See `docs/AUTOMATION_WORKFLOWS.md` for the full n8n / Make.com / Zapier comparison and guidance on when to use each.

## Setup

See [setup.md](setup.md) for the full walkthrough: sheet creation, trigger configuration, field mapping, and testing.
