import type { Metadata } from 'next';
import { ArchitectureFlow } from './architecture-flow';

export const metadata: Metadata = {
  title: 'Architecture',
  description:
    'Interactive system architecture for JobOps Copilot — Next.js web, Express API, a Python FastAPI agent (LangChain, RAG over pgvector, telemetry), Azure data and platform services, and companion automation.',
};

export default function ArchitecturePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-primary text-sm font-medium">System design</p>
      <h1 className="font-heading mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
        Architecture
      </h1>
      <p className="text-muted-foreground mt-3 max-w-2xl text-sm sm:text-base">
        An interactive map of how JobOps Copilot fits together — drag to pan, scroll to
        zoom, and click any node with an <span className="text-foreground">↗</span> to open
        its source. The Node API owns the CRM and orchestration; a Python service owns the
        real AI. Follow the <span className="text-teal-400">teal</span> path for the AI
        pipeline.
      </p>

      <div className="bg-card mt-6 h-[72vh] min-h-[520px] overflow-hidden rounded-xl border">
        <p className="sr-only">
          System architecture: a browser uses the Next.js web app, which calls the Express API
          over REST. The API delegates AI work to a Python FastAPI agent (LangChain
          multi-provider LLMs, retrieval-augmented generation, and pandas telemetry). Data is
          stored in Azure PostgreSQL with the pgvector extension. Supporting services include
          Azure Blob Storage for report exports, Hugging Face sentence-transformer embeddings,
          n8n / Make / Zapier automation feeding the API webhooks, and Azure platform services
          (Application Insights, Key Vault, and Log Analytics).
        </p>
        <ArchitectureFlow />
      </div>

      <p className="text-muted-foreground mt-4 text-xs">
        Prefer a static image? The same diagram lives in the{' '}
        <a
          className="underline underline-offset-2"
          href="https://github.com/Taleef7/jobops-copilot#readme"
        >
          README
        </a>{' '}
        and in{' '}
        <a
          className="underline underline-offset-2"
          href="https://github.com/Taleef7/jobops-copilot/blob/main/docs/ARCHITECTURE.md"
        >
          docs/ARCHITECTURE.md
        </a>
        .
      </p>
    </div>
  );
}
