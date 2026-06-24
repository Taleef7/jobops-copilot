import { parse, type HTMLElement } from 'node-html-parser';

export type WorkplaceType = 'remote' | 'hybrid' | 'onsite' | 'flexible';

export interface ExtractedJob {
  title?: string;
  company?: string;
  location?: string;
  descriptionText?: string;
  workplaceType?: WorkplaceType;
  source: 'jsonld' | 'opengraph' | 'heuristic' | 'none';
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** JSON-LD descriptions are usually HTML; flatten to readable text. */
function htmlToText(html: string): string | undefined {
  const text = parse(html).structuredText.trim();
  return text.length > 0 ? text : undefined;
}

function collectJsonLd(root: HTMLElement): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const node of root.querySelectorAll('script[type="application/ld+json"]')) {
    let data: unknown;
    try {
      data = JSON.parse(node.text);
    } catch {
      continue;
    }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (item && typeof item === 'object') {
        out.push(item as Record<string, unknown>);
        const graph = (item as { '@graph'?: unknown })['@graph'];
        if (Array.isArray(graph)) {
          for (const g of graph) if (g && typeof g === 'object') out.push(g as Record<string, unknown>);
        }
      }
    }
  }
  return out;
}

function hasJobPostingType(obj: Record<string, unknown>): boolean {
  const t = obj['@type'];
  return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'));
}

function companyFrom(org: unknown): string | undefined {
  if (typeof org === 'string') return clean(org);
  if (org && typeof org === 'object') return clean((org as { name?: unknown }).name);
  return undefined;
}

function locationFrom(loc: unknown): string | undefined {
  const first = Array.isArray(loc) ? loc[0] : loc;
  if (!first || typeof first !== 'object') return undefined;
  const address = (first as { address?: unknown }).address;
  if (typeof address === 'string') return clean(address);
  if (!address || typeof address !== 'object') return undefined;
  const a = address as Record<string, unknown>;
  const parts = [a.addressLocality, a.addressRegion, a.addressCountry]
    .map(clean)
    .filter((p): p is string => p !== undefined);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function fromJsonLd(root: HTMLElement): Partial<ExtractedJob> {
  const job = collectJsonLd(root).find(hasJobPostingType);
  if (!job) return {};
  const desc = clean(job.description);
  const locationType = typeof job.jobLocationType === 'string' ? job.jobLocationType.toUpperCase() : '';
  return {
    title: clean(job.title),
    company: companyFrom(job.hiringOrganization),
    location: locationFrom(job.jobLocation),
    descriptionText: desc ? (htmlToText(desc) ?? desc) : undefined,
    workplaceType: locationType === 'TELECOMMUTE' ? 'remote' : undefined,
  };
}

function metaContent(root: HTMLElement, selector: string): string | undefined {
  return clean(root.querySelector(selector)?.getAttribute('content'));
}

function fromMeta(root: HTMLElement): Partial<ExtractedJob> {
  return {
    title: metaContent(root, 'meta[property="og:title"]'),
    company: metaContent(root, 'meta[property="og:site_name"]'),
    descriptionText:
      metaContent(root, 'meta[property="og:description"]') ?? metaContent(root, 'meta[name="description"]'),
  };
}

function fromHeuristic(root: HTMLElement): Partial<ExtractedJob> {
  const title =
    clean(root.querySelector('h1')?.text) ?? clean(root.querySelector('title')?.text);
  for (const node of root.querySelectorAll('script, style, nav, header, footer')) node.remove();
  const body = root.querySelector('body') ?? root;
  const text = body.structuredText.trim();
  return { title, descriptionText: text.length > 0 ? text.slice(0, 20_000) : undefined };
}

export function extractJobFromHtml(html: string): ExtractedJob {
  const root = parse(html);
  // Evaluated eagerly left-to-right: fromJsonLd/fromMeta must read the tree
  // BEFORE fromHeuristic mutates it (it strips script/style/etc.). Keep this
  // order and don't wrap a tier in a lazy thunk, or the heuristic's mutation
  // would race the earlier readers.
  const tiers: Array<[ExtractedJob['source'], Partial<ExtractedJob>]> = [
    ['jsonld', fromJsonLd(root)],
    ['opengraph', fromMeta(root)],
    ['heuristic', fromHeuristic(root)],
  ];

  const result: ExtractedJob = { source: 'none' };
  for (const [tier, data] of tiers) {
    let used = false;
    if (result.title === undefined && data.title !== undefined) { result.title = data.title; used = true; }
    if (result.company === undefined && data.company !== undefined) { result.company = data.company; used = true; }
    if (result.location === undefined && data.location !== undefined) { result.location = data.location; used = true; }
    if (result.descriptionText === undefined && data.descriptionText !== undefined) {
      result.descriptionText = data.descriptionText;
      used = true;
    }
    if (result.workplaceType === undefined && data.workplaceType !== undefined) {
      result.workplaceType = data.workplaceType;
      used = true;
    }
    if (used && result.source === 'none') result.source = tier;
  }
  return result;
}
