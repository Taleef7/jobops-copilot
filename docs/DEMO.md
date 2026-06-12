# Demo Script

A ~5-minute walkthrough that shows the AI capabilities end to end. Each step
names the JD-relevant skill it demonstrates.

## Setup (once)

```bash
# Terminal 1 — Node API + web
npm install && npm run dev                      # web :3000, api :4000

# Terminal 2 — Python agent service (the real AI)
cd services/agent
python -m venv .venv && .venv/Scripts/activate  # or: source .venv/bin/activate
pip install -r requirements-dev.txt -r requirements-rag.txt
cp .env.example .env                            # set one provider key
uvicorn app.main:app --reload --port 8000
```

In the repo-root `.env`: `AGENT_SERVICE_URL=http://127.0.0.1:8000` (and
`DATABASE_URL` + `pgvector` enabled to show RAG). Restart the API after editing.

> Without the agent or a key, every step still works via the deterministic mock —
> good for proving graceful degradation.

## Walkthrough

1. **Dashboard → pipeline telemetry intelligence.** On the home page, click
   **Analyze pipeline telemetry**: pandas computes trend/anomaly/forecast over
   the CRM and an LLM narrates it. Then click **EV battery telemetry demo** — the
   *same* analyzer flags an injected anomaly in synthetic battery-health data.
   *Demonstrates: time-series intelligence, pattern recognition, predictive
   maintenance — directly transferable to vehicle telemetry.*

2. **Open a job → AI analysis.** Click **Parse job** then **Score fit**. The fit
   score, matched/missing skills, and model name come from a real LLM; with the
   DB enabled, the score is **grounded in retrieved resume evidence** (pgvector +
   Hugging Face embeddings). *Demonstrates: LLMs, prompt engineering, RAG, vector
   databases.*

3. **Job → AI agents.** In the **AI agents** panel:
   - **Interview prep** — likely questions, talking points, honest gaps.
   - **Research company** — a tool-using agent runs a web search and returns a
     structured brief (badge shows whether search ran).
   - **Skill-gap plan** — a prioritized learning plan with resources + timelines.
   *Demonstrates: agent orchestration, tool use, structured output.*

4. **Outreach (human-in-the-loop).** Generate a recruiter draft; note it is
   **draft-only** and never auto-sent. *Demonstrates: responsible AI / generative
   applications.*

5. **Provider swap (talking point).** Change `LLM_PROVIDER` (anthropic →
   azure_openai → google_genai) and re-run a step — same code, different
   provider. *Demonstrates: provider-agnostic design.*

## One-shot API checks (no UI)

```bash
# Real LLM parse via the API → Python agent
curl -s localhost:4000/api/ai/parse-job -H 'Content-Type: application/json' \
  -d '{"description_text":"AI Software Engineer. Python, PyTorch, LangChain, RAG."}'

# Telemetry + EV demo
curl -s localhost:4000/api/telemetry/insights
curl -s localhost:4000/api/telemetry/ev-demo

# Agent health (provider + RAG status)
curl -s localhost:8000/health
```

## Live cloud demo (deployed stack)

To present from the **deployed** stack instead of local servers, use the operator
script `scripts/azure/demo.sh` (needs `az login`; it acts only via your own Azure
session and stores no credentials):

```bash
az login                         # if your token has expired
scripts/azure/demo.sh warm       # wake the agent + allow-list your IP + health-gate
# ... present using the live web URL that 'warm' prints ...
scripts/azure/demo.sh cool       # back to scale-to-zero idle + remove the firewall rule
```

- `warm` scales the Container App agent to `min-replicas=1`, adds a single
  fixed-name Postgres firewall rule for your current IP, and waits until web, API
  (`/api/health/ready` → `db:ok`) and agent (`/health`) are all green.
- `status` runs the same checks read-only (safe anytime).
- `cool` returns the agent to scale-to-zero and deletes the firewall rule.

> **Cost:** the agent at `min-replicas=1` bills ~$20–30/mo on 1 vCPU / 2 GiB, so
> always run `cool` after the demo. Resource names default to the live deployment
> (resource group `projects`, agent region `eastus`) and can be overridden with the
> `RESOURCE_GROUP` / `AGENT_APP` / `WEB_APP` / `API_APP` / `PG_SERVER` env vars.

> For longer idle periods (not just between demos), `scripts/azure/lifecycle.sh pause`
> stops the database and agent too — see "Cost controls" in `docs/AZURE_DEPLOYMENT.md`.

## What to emphasize in the interview

- Real, **provider-agnostic** LLM integration with structured output and a safe
  mock fallback.
- **RAG** grounded in resume evidence (pgvector + Hugging Face / PyTorch).
- **Multi-step agents** with genuine tool use (web search).
- **Time-series** analysis that transfers from the job pipeline to **vehicle
  telemetry** (the EV demo) — anomaly detection + forecasting + predictive
  maintenance framing.
- Production hygiene: TypeScript + Python **CI**, tests, protected `main`,
  Azure Postgres, and an App Service deploy path.
