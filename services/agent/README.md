# JobOps Copilot — AI Agent Service

A Python **FastAPI** microservice that provides the real, LLM-powered AI layer
for JobOps Copilot. The Node API (`apps/api`) delegates analysis to this service
when `AGENT_SERVICE_URL` is set, and transparently falls back to its
deterministic mock when the service is unavailable or unconfigured.

Built with **LangChain** on a **provider-agnostic** model router: Anthropic
Claude, Azure OpenAI, OpenAI, or Google Gemini — selected by `LLM_PROVIDER` or
auto-detected from whichever credentials are present.

## Endpoints (Phase 9)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness + whether an LLM provider is configured. |
| `POST` | `/parse-job` | Structured job-description parsing. |
| `POST` | `/score-fit` | Honest, evidence-grounded resume/job fit scoring. |
| `POST` | `/draft-outreach` | Human-review outreach drafting. |
| `POST` | `/weekly-recommendations` | LLM-narrated weekly strategy recommendations. |
| `POST` | `/rag/ingest` | Chunk + embed a document into the pgvector store. |
| `POST` | `/rag/search` | Cosine-similarity retrieval over stored embeddings. |
| `POST` | `/agents/interview-prep` | Interview-prep agent (structured brief). |
| `POST` | `/agents/research` | Company/role research agent (web-search tool use). |
| `POST` | `/agents/skill-gap` | Skill-gap learning-plan agent. |

RAG (Phase 10): `score-fit` is **retrieval-augmented** — it ingests the resume
into pgvector (Hugging Face `all-MiniLM-L6-v2` embeddings, on PyTorch) and feeds
the chunks most relevant to the job description back to the model so the
assessment is grounded in real resume evidence. RAG is best-effort: when
`DATABASE_URL` is unset the service scores directly without it.

Agents (Phase 8): real LangChain agents built with `create_agent` + `ToolStrategy`
for provider-agnostic structured output. The research agent uses a Tavily-backed
`web_search` tool (degrades gracefully without `TAVILY_API_KEY`). They require a
configured LLM provider — unlike the analysis chains, they have no mock fallback.

Later phases add `/telemetry/*` (Phase 11).

Each endpoint returns **structured, validated JSON** whose shape mirrors the
TypeScript contracts in `apps/api/src/lib/analysis-core.ts`, so the Node API
consumes responses without translation. When no provider is configured the
endpoints return `503` and the Node API uses its mock.

## Local development

```bash
cd services/agent
python -m venv .venv
.venv/Scripts/activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -r requirements-dev.txt

cp .env.example .env          # set a provider key, e.g. ANTHROPIC_API_KEY
uvicorn app.main:app --reload --port 8000
```

Point the Node API at it:

```bash
# in the repo root .env
AGENT_SERVICE_URL=http://127.0.0.1:8000
```

## Tests & lint

```bash
pytest          # CI-safe: runs without any provider credentials
ruff check app tests
```

## Configuration

See `.env.example`. Key variables: `LLM_PROVIDER`, `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `AZURE_OPENAI_*`, `GOOGLE_GEMINI_API_KEY`, `DATABASE_URL`
(Phase 10 RAG), `TAVILY_API_KEY` (Phase 8 research agent).

## Safety

The prompts enforce JobOps Copilot's rules: stay grounded in the source text,
never fabricate resume experience, keep recommendations honest and
conservative, and never imply auto-sending. Outreach is always human-reviewed.
