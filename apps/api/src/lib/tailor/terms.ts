import { keywordCatalog } from '@/lib/analysis-core';
import { escapeRegex, norm, plain } from './text';

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
const CASED_ALIASES: Record<string, string> = { Node: 'Node.js', TS: 'TypeScript', ML: 'Machine Learning' };

/**
 * Names that are also English words or letters. They count only as written (capitalised) and
 * not before a hyphen, so "go-to-market" and "ready to go" aren't the Go language.
 */
const AMBIGUOUS = new Set(
  ['go', 'r', 'c', 'swift', 'rust', 'spark', 'ruby', 'excel', 'chef', 'puppet', 'express', 'spring', 'lambda',
    'glue', 'unity', 'flutter', 'helm', 'hive', 'rag', 'sass', 'oracle', 'stripe', 'sentry'],
);

interface Term {
  key: string;
  display: string;
  pattern: RegExp;
  /** Matched against the text as written (case-sensitive) rather than lower-cased. */
  cased: boolean;
}

export type Vocab = Term[];

const WORD = '\\p{L}\\p{N}+#';

function pattern(form: string, cased: boolean): RegExp {
  const body = escapeRegex(form);
  // "R&D" and "Q&A" aren't the R language.
  if (cased) return new RegExp(`(?<![${WORD}.&'-])${body}(?![${WORD}&'-])`, 'u');
  // A trailing "s" is allowed on a word ("LLMs"), not on a symbol ("C++").
  const plural = /\p{L}$/u.test(form) ? 's?' : '';
  return new RegExp(`(?<![${WORD}.])${body}${plural}(?![${WORD}])`, 'u');
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

  const add = (form: string, key: string, display: string, casedForm?: boolean) => {
    const lower = norm(form);
    if (!lower) return;
    const cased = casedForm ?? AMBIGUOUS.has(lower);
    const id = cased ? `C:${plain(form)}` : `L:${lower}`;
    if (byForm.has(id)) return;
    byForm.set(id, { key, display, pattern: pattern(cased ? plain(form) : lower, cased), cased });
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
    const key = known?.key ?? norm(forms[0]!);
    const display = known?.display ?? forms[0]!;
    for (const form of forms) {
      add(form, key, display);
      if (!keyOf.has(norm(form))) keyOf.set(norm(form), { key, display });
    }
  }
  return [...byForm.values()];
}

/** The terms in `text`, by key, in vocabulary order. */
export function termsIn(text: string, vocab: Vocab): string[] {
  const asWritten = plain(text);
  const lower = norm(text);
  const keys = new Set<string>();
  for (const term of vocab) {
    if (term.pattern.test(term.cased ? asWritten : lower)) keys.add(term.key);
  }
  return [...keys];
}

/** How a term is shown to the user. */
export function displayOf(key: string, vocab: Vocab): string {
  return vocab.find((term) => term.key === key)?.display ?? key;
}
