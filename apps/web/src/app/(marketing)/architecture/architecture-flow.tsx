'use client';

import { useCallback } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const REPO = 'https://github.com/Taleef7/jobops-copilot/tree/main';
const LIVE = 'https://jobops-web.azurewebsites.net';

type Kind = 'client' | 'core' | 'ai' | 'data' | 'platform' | 'automation';

type BpData = {
  title: string;
  sub?: string;
  kind: Kind;
  href?: string;
};

type BpNode = Node<BpData, 'bp'>;

const ACCENT: Record<Kind, string> = {
  client: '#38bdf8',
  core: '#38bdf8',
  ai: '#5eead4',
  data: '#38bdf8',
  platform: '#4d77a0',
  automation: '#38bdf8',
};

const handleStyle = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 'none',
  background: 'transparent',
} as const;

const SIDES: Array<['top' | 'right' | 'bottom' | 'left', Position]> = [
  ['top', Position.Top],
  ['right', Position.Right],
  ['bottom', Position.Bottom],
  ['left', Position.Left],
];

function BlueprintNode({ data }: NodeProps<BpNode>) {
  const accent = ACCENT[data.kind];
  const isAi = data.kind === 'ai';
  return (
    <div
      style={{
        width: '100%',
        padding: '10px 12px',
        borderRadius: 4,
        background: isAi ? '#0c2230' : '#0e1f33',
        border: `1px solid ${accent}`,
        fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
        cursor: data.href ? 'pointer' : 'default',
        boxShadow: isAi ? '0 0 0 1px rgba(94,234,212,0.15)' : 'none',
      }}
    >
      {SIDES.map(([id, position]) => (
        <span key={id}>
          <Handle id={id} type="source" position={position} style={handleStyle} isConnectable={false} />
          <Handle id={id} type="target" position={position} style={handleStyle} isConnectable={false} />
        </span>
      ))}
      <div style={{ color: isAi ? '#b8fff0' : '#cfe8ff', fontSize: 12.5, fontWeight: 600 }}>
        {data.title}
        {data.href ? <span style={{ color: accent, opacity: 0.7 }}> ↗</span> : null}
      </div>
      {data.sub ? (
        <div style={{ color: isAi ? '#86c9bd' : '#6f93b4', fontSize: 10, marginTop: 3 }}>{data.sub}</div>
      ) : null}
    </div>
  );
}

const nodeTypes: NodeTypes = { bp: BlueprintNode };

const node = (
  id: string,
  x: number,
  y: number,
  width: number,
  data: BpData,
): BpNode => ({ id, type: 'bp', position: { x, y }, data, style: { width }, draggable: false });

const nodes: BpNode[] = [
  // providers cluster (above agent)
  node('providers', 632, 0, 250, {
    title: 'LLM providers ×4',
    sub: 'anthropic · azure openai · openai · gemini',
    kind: 'ai',
  }),
  // spine
  node('browser', 0, 150, 132, { title: 'browser', sub: '(the user)', kind: 'client' }),
  node('web', 184, 142, 182, {
    title: 'web · next.js 16',
    sub: 'react 19 · tailwind · clerk auth',
    kind: 'core',
    href: LIVE,
  }),
  node('api', 426, 142, 196, {
    title: 'api · express + ts',
    sub: 'crud · ai proxy · n8n webhooks',
    kind: 'core',
    href: `${REPO}/apps/api`,
  }),
  node('agent', 680, 130, 200, {
    title: 'agent · python fastapi',
    sub: 'langchain · RAG · multi-step agents',
    kind: 'ai',
    href: `${REPO}/services/agent`,
  }),
  node('postgres', 936, 142, 176, {
    title: 'azure postgres',
    sub: 'pgvector · jobs CRM + embeddings',
    kind: 'data',
    href: `${REPO}/db/migrations`,
  }),
  // second row
  node('blob', 426, 300, 196, {
    title: 'azure blob storage',
    sub: 'weekly report exports',
    kind: 'data',
  }),
  node('embeddings', 680, 300, 200, {
    title: 'hf sentence-transformers',
    sub: 'embeddings · pytorch (cpu)',
    kind: 'ai',
  }),
  // automation
  node('n8n', 0, 452, 150, { title: 'n8n', sub: 'self-host orchestrator', kind: 'automation', href: `${REPO}/workflows/n8n` }),
  node('make', 168, 452, 150, { title: 'make.com', sub: 'webhook → api', kind: 'automation', href: `${REPO}/workflows/make` }),
  node('zapier', 336, 452, 150, { title: 'zapier', sub: 'sheet → calendar', kind: 'automation', href: `${REPO}/workflows/zapier` }),
  // azure platform
  node('appinsights', 560, 452, 170, { title: 'app insights', sub: 'traces · metrics · alerts', kind: 'platform' }),
  node('keyvault', 758, 452, 160, { title: 'key vault', sub: 'secrets · managed identity', kind: 'platform' }),
  node('loganalytics', 946, 452, 150, { title: 'log analytics', sub: '1 GB/day cap', kind: 'platform' }),
];

const CYAN = '#38bdf8';
const TEAL = '#5eead4';
const MUTED = '#6c89a6';

const edge = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  label: string,
  color: string,
  opts: { animated?: boolean; dashed?: boolean } = {},
): Edge => ({
  id,
  source,
  target,
  sourceHandle,
  targetHandle,
  label,
  type: 'smoothstep',
  animated: opts.animated ?? false,
  style: { stroke: color, strokeWidth: 1.4, strokeDasharray: opts.dashed ? '6 3' : undefined },
  labelStyle: { fill: '#9fbdd8', fontFamily: 'ui-monospace, monospace', fontSize: 10 },
  labelBgStyle: { fill: '#0a1626', fillOpacity: 0.9 },
  labelBgPadding: [4, 2],
  labelBgBorderRadius: 3,
  markerEnd: undefined,
});

const edges: Edge[] = [
  edge('e-browser-web', 'browser', 'right', 'web', 'left', 'https', CYAN),
  edge('e-web-api', 'web', 'right', 'api', 'left', 'REST · /api/proxy', CYAN),
  edge('e-api-agent', 'api', 'right', 'agent', 'left', 'delegate AI', TEAL, { animated: true }),
  edge('e-agent-pg', 'agent', 'right', 'postgres', 'left', 'RAG · SQL', TEAL),
  edge('e-prov-agent', 'providers', 'bottom', 'agent', 'top', 'init_chat_model', TEAL, { animated: true }),
  edge('e-agent-emb', 'agent', 'bottom', 'embeddings', 'top', 'embed', TEAL),
  edge('e-emb-pg', 'embeddings', 'right', 'postgres', 'bottom', 'upsert vectors', TEAL, { dashed: true }),
  edge('e-api-blob', 'api', 'bottom', 'blob', 'top', 'exports', CYAN),
  edge('e-api-pg', 'api', 'bottom', 'postgres', 'bottom', 'CRM read/write', CYAN),
  edge('e-n8n-api', 'n8n', 'top', 'api', 'bottom', '', CYAN),
  edge('e-make-api', 'make', 'top', 'api', 'bottom', 'POST /api/n8n/*', CYAN),
  edge('e-zap-api', 'zapier', 'top', 'api', 'bottom', '', CYAN),
  edge('e-ai-api', 'appinsights', 'top', 'api', 'bottom', 'telemetry', MUTED, { dashed: true }),
  edge('e-kv-api', 'keyvault', 'top', 'api', 'bottom', 'secrets', MUTED, { dashed: true }),
];

export function ArchitectureFlow() {
  const onNodeClick = useCallback((_event: unknown, clicked: Node) => {
    const href = (clicked.data as BpData).href;
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <ReactFlow
      nodeTypes={nodeTypes}
      defaultNodes={nodes}
      defaultEdges={edges}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      colorMode="dark"
      minZoom={0.3}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      proOptions={{ hideAttribution: false }}
      onNodeClick={onNodeClick}
      style={{ background: '#0a1626' }}
    >
      <Background variant={BackgroundVariant.Lines} gap={24} color="#13314d" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
