# Debugging the agent graphs locally (langgraph dev + Studio)

The agent service exposes five LangGraph graphs (assistant + feed-curator,
resume-tailor, apply-copilot, connection-scout). You can step through any of
them visually in the free, local LangGraph Studio — no hosted platform,
no LangSmith account required.

## One-time setup

    cd services/agent
    pip install -r requirements.txt -r requirements-dev.txt

## Run

    cd services/agent
    LANGSMITH_TRACING=false langgraph dev

(PowerShell: `$env:LANGSMITH_TRACING = 'false'; langgraph dev`)

`langgraph dev` reads `langgraph.json`, serves the graphs on
http://127.0.0.1:2024, and prints a Studio URL of the form
`https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024`.
The Studio *UI* is served from that domain but talks only to your local
server; with `LANGSMITH_TRACING=false` application execution traces are not
uploaded to LangSmith. Langfuse remains the project's only observability
plane (spec section 10).

## Notes

- Provider keys come from `services/agent/.env` as usual; the stub graphs run
  key-less, so you can inspect graph shape and interrupts with no keys at all.
- Persistence inside `langgraph dev` is its own in-memory layer — threads you
  create in Studio do not touch the Postgres checkpointer.
- This is a debugging tool only. Never deploy `langgraph dev`/`langgraph-api`;
  the spec explicitly rejects LangGraph Platform and self-hosted langgraph-api
  (docs/superpowers/specs/2026-08-12-jobright-parity-design.md, section 14).
