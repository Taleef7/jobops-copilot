import { keywordCatalog } from '@/lib/analysis-core';
import { contentTokens, escapeRegex, norm, plain, wordStems } from './text';

/**
 * Skill and tool names, so a tailored line can't add one (#351, SPEC rule 6). The list is the
 * common tools below plus the résumé's own skills, the posting's keywords from the fit read,
 * and the keywords the user confirmed: whatever the model might be tempted to add.
 */

const COMMON_TOOLS = [
  ...keywordCatalog.filter((term) => term !== 'Analytics' && term !== 'Workflow automation'),
  'Amazon Web Services', 'EC2', 'S3', 'Lambda', 'DynamoDB', 'Redshift', 'Athena', 'Glue', 'Kinesis', 'SQS', 'SNS',
  'SageMaker', 'CloudFormation', 'ECS', 'EKS', 'AKS', 'GKE', 'BigQuery', 'Vertex AI', 'Pub/Sub', 'Dataflow',
  'Azure DevOps', 'Data Factory', 'Synapse', 'Databricks', 'Tableau', 'Power BI', 'Looker', 'Excel', 'R', 'C',
  'Scala', 'Haskell', 'Elixir', 'Erlang', 'Perl', 'MATLAB', 'SAS', 'SPSS', 'Hadoop', 'Hive', 'Flink', 'pandas',
  'NumPy', 'scikit-learn', 'Keras', 'Hugging Face', 'Ansible', 'Puppet', 'Chef', 'Jenkins', 'GitHub Actions',
  'GitLab', 'CircleCI', 'Helm', 'Istio', 'Nginx', 'Cassandra', 'Oracle', 'SQL Server', 'SQLite', 'MariaDB',
  'Neo4j', 'Firebase', 'Supabase', 'Heroku', 'Vercel', 'Svelte', 'jQuery', 'Redux', 'Webpack', 'HTML', 'CSS',
  'Sass', 'Figma', 'Jira', 'Salesforce', 'HubSpot', 'SAP', 'Shopify', 'Stripe', 'Twilio', 'Selenium',
  'Cypress', 'pytest', 'JUnit', 'Objective-C', 'Flutter', 'React Native', 'Android', 'iOS', 'Unity',
  'Solidity', 'OpenTelemetry', 'Splunk', 'New Relic', 'Sentry', 'Okta', 'OAuth', 'SAML', 'Kibana',
  'Pulumi', 'Bash', 'PowerShell', 'MLflow', 'Kubeflow', 'LangGraph', 'LlamaIndex', 'NLP', 'Computer Vision',
  'OpenCV', 'CUDA', 'HIPAA', 'GDPR', 'SOC 2', 'PCI DSS', 'FHIR', 'HL7', 'ASP.NET',
];

/** Other names for the same tool: the left side is matched, the right side is the tool. */
const ALIASES: Record<string, string> = {
  golang: 'Go',
  js: 'JavaScript',
  k8s: 'Kubernetes',
  postgres: 'PostgreSQL',
  nodejs: 'Node.js',
  reactjs: 'React',
  'react.js': 'React',
  vuejs: 'Vue',
  'vue.js': 'Vue',
  nextjs: 'Next.js',
  gcp: 'Google Cloud',
  'google cloud platform': 'Google Cloud',
  aws: 'Amazon Web Services',
  dotnet: '.NET',
  mongo: 'MongoDB',
  sklearn: 'scikit-learn',
  pyspark: 'Spark',
  elastic: 'Elasticsearch',
};

/** Aliases that are ordinary words in lower case: matched only as written. */
const CASED_ALIASES: Record<string, string> = { Node: 'Node.js', ML: 'Machine Learning' };

/** A cloud's own services name the cloud too: "EC2 and S3" is evidence for AWS. */
const PART_OF: Record<string, string> = Object.fromEntries([
  ...['ec2', 's3', 'lambda', 'dynamodb', 'redshift', 'athena', 'glue', 'kinesis', 'sqs', 'sns', 'sagemaker',
    'cloudformation', 'ecs', 'eks'].map((key) => [key, 'amazon web services']),
  ...['bigquery', 'gke', 'vertex ai', 'pub/sub', 'dataflow'].map((key) => [key, 'google cloud']),
  ...['aks', 'azure functions', 'azure blob storage', 'azure devops', 'data factory', 'synapse', 'azure openai'].map(
    (key) => [key, 'azure'],
  ),
]);

/**
 * Names that are also English words or letters. In a suggested line they count only when
 * capitalised ("Go", "RUST"), so "ready to go" and "go-to-market" aren't the Go language.
 */
const AMBIGUOUS = new Set(
  ['go', 'r', 'c', 'swift', 'rust', 'spark', 'ruby', 'excel', 'chef', 'puppet', 'express', 'spring', 'lambda',
    'glue', 'unity', 'flutter', 'helm', 'hive', 'rag', 'sass', 'oracle', 'stripe', 'sentry'],
);

/** Posting keywords this short ("IT", "US") are ordinary words more often than skills. */
const MIN_KEYWORD_LENGTH = 3;

interface Term {
  key: string;
  display: string;
  /** For a suggested line: ambiguous names only as written. */
  strict: RegExp;
  /** For evidence: any case, so a base line's "spark" still counts. */
  loose: RegExp;
  /**
   * A posting phrase that isn't a tool ("Payment APIs"): as evidence, its words count
   * wherever they are ("payment and billing APIs").
   */
  words?: string[];
}

export type Vocab = Term[];

const WORD = '\\p{L}\\p{N}+#';

/** A word's plural or singular: "payments" and "payment", "APIs" and "API". */
function body(form: string): string {
  if (!/^[\p{L} ]+$/u.test(form)) return escapeRegex(form); // "C++", "Node.js", "CI/CD"
  const singular = form.length > 3 && /[^s]s$/.test(form) ? form.slice(0, -1) : form;
  return `${escapeRegex(singular)}(?:s|es)?`;
}

function patterns(form: string, ambiguous: boolean): Pick<Term, 'strict' | 'loose'> {
  // Never "R&D", "Q&A", or the "go" of "go-to-market"; "Rust-based" and "Rust's" are Rust.
  const before = `(?<![${WORD}.&'])`;
  const after = `(?![${WORD}&]|'(?!s(?![\\p{L}]))|-to-)`;
  const loose = new RegExp(`${before}${body(norm(form))}${after}`, 'u');
  if (!ambiguous) return { strict: loose, loose };
  const asWritten = plain(form);
  const variants = [asWritten, ...(asWritten.length >= 3 ? [asWritten.toUpperCase()] : [])].map(escapeRegex);
  const strict = new RegExp(`${before}(?:${variants.join('|')})${after}`, 'u');
  return { strict, loose };
}

/** The forms a résumé skill can be written in: "Amazon Web Services (AWS)" gives both. */
function formsOf(term: string): string[] {
  const forms = new Set<string>([term]);
  const paren = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(term);
  if (paren) {
    forms.add(paren[1]!.trim());
    forms.add(paren[2]!.trim());
  }
  for (const form of [...forms]) {
    const unversioned = form.replace(/\s+v?\d+(?:\.\d+)*$/i, '').trim();
    if (unversioned) forms.add(unversioned);
  }
  return [...forms].filter((form) => form.length > 0 && form.length <= 40 && form.split(/\s+/).length <= 4);
}

/** The vocabulary: the common tools and their aliases, plus `extra` terms (skills, keywords). */
export function buildVocab(extra: string[]): Vocab {
  const byForm = new Map<string, Term>();
  const keyOf = new Map<string, { key: string; display: string }>();
  const phrases: Array<{ key: string; words: string[] }> = [];

  const add = (form: string, key: string, display: string, casedForm?: boolean) => {
    const lower = norm(form);
    if (!lower) return;
    const ambiguous = casedForm ?? AMBIGUOUS.has(lower);
    const id = ambiguous ? `C:${plain(form)}` : `L:${lower}`;
    if (byForm.has(id)) return;
    byForm.set(id, { key, display, ...patterns(form, ambiguous) });
  };

  for (const tool of COMMON_TOOLS) {
    // The catalog has some tools by their alias ("AWS", "GCP").
    const display = ALIASES[norm(tool)] ?? tool;
    const key = norm(display);
    keyOf.set(norm(tool), { key, display });
    add(tool, key, display);
  }
  for (const [alias, tool] of Object.entries(ALIASES)) {
    keyOf.set(norm(alias), { key: norm(tool), display: tool });
    add(alias, norm(tool), tool);
  }
  for (const [alias, tool] of Object.entries(CASED_ALIASES)) add(alias, norm(tool), tool, true);

  for (const term of extra) {
    const forms = formsOf(plain(term).trim());
    if (forms.length === 0) continue;
    // A known tool by any of its forms keeps the tool's key, so "AWS" and "Amazon Web
    // Services" are one term.
    const known = forms.map((form) => keyOf.get(norm(form))).find(Boolean);
    if (!known && norm(forms[0]!).length < MIN_KEYWORD_LENGTH) continue;
    const key = known?.key ?? norm(forms[0]!);
    const display = known?.display ?? forms[0]!;
    for (const form of forms) {
      add(form, key, display);
      if (!keyOf.has(norm(form))) keyOf.set(norm(form), { key, display });
    }
    const words = contentTokens(forms[0]!);
    if (!known && words.length > 1) phrases.push({ key, words });
  }
  // Each phrase's words go on its first term (any form will do: they share the key).
  for (const { key, words } of phrases) {
    const term = [...byForm.values()].find((candidate) => candidate.key === key);
    if (term && !term.words) term.words = words;
  }
  return [...byForm.values()];
}

/**
 * The terms in `text`, by key, in vocabulary order. `evidence` reads leniently (any case, and a
 * cloud's own services count as the cloud), so a base résumé's wording never blocks an honest
 * rewrite; a suggested line is read strictly.
 */
export function termsIn(text: string, vocab: Vocab, options: { evidence?: boolean } = {}): string[] {
  const asWritten = plain(text);
  const lower = norm(text);
  const keys = new Set<string>();
  const stems = options.evidence ? wordStems(text) : null;
  for (const term of vocab) {
    const found = stems
      ? term.loose.test(lower) || Boolean(term.words?.every((word) => stems.has(word)))
      : term.strict.test(term.strict === term.loose ? lower : asWritten);
    if (found) keys.add(term.key);
  }
  if (options.evidence) for (const key of [...keys]) if (PART_OF[key]) keys.add(PART_OF[key]);
  return [...keys];
}

/** How a term is shown to the user. */
export function displayOf(key: string, vocab: Vocab): string {
  return vocab.find((term) => term.key === key)?.display ?? key;
}
