import type { StructuredResume } from '@/types';

/**
 * A second résumé and posting for the cover letter's check (#416): the final review's probes, an
 * SRE whose letter uses ordinary openers ("Reliability is…", "Ownership means…"). The honest
 * sentences and letter must pass; the invented claims must be dropped.
 */
export const SRE_BASE: StructuredResume = {
  basics: {
    name: 'Priya Raman',
    label: 'Site Reliability Engineer',
    email: 'priya.raman@example.com',
    summary: 'Site reliability engineer who keeps Kubernetes platforms on AWS healthy and on-call calm.',
    location: { city: 'Pittsburgh', region: 'PA', countryCode: 'US' },
  },
  work: [
    {
      company: 'Northwind Logistics',
      position: 'Site Reliability Engineer',
      startDate: '2021-03-01',
      current: true,
      highlights: [
        'Migrated 40 services to Kubernetes on AWS EKS with Terraform',
        'Built Prometheus and Grafana alerting that cut pages by 35%',
        'Ran blameless postmortems and wrote runbooks for the on-call rotation',
        'Mentored four junior engineers through their first on-call shifts',
        'Defined SLOs for the shipment tracking API with product teams',
      ],
    },
    {
      company: 'Contoso Health',
      position: 'Software Engineer',
      startDate: '2018-06-01',
      endDate: '2021-02-01',
      highlights: [
        'Built Python services for claims processing on PostgreSQL',
        'Automated deploys with GitHub Actions, cutting release time from 2 hours to 20 minutes',
      ],
    },
  ],
  education: [{ institution: 'Carnegie Mellon University', studyType: 'BS', area: 'Information Systems' }],
  skills: [
    { category: 'Tools', skills: ['Python', 'Go', 'Kubernetes', 'Terraform', 'Prometheus', 'Grafana', 'AWS', 'PostgreSQL', 'GitHub Actions'] },
  ],
};

export const SRE_JOB = {
  title: 'Senior Site Reliability Engineer',
  company: 'Fabrikam',
  descriptionText:
    'Fabrikam builds routing software for regional freight carriers. As a Senior Site Reliability Engineer you will own the reliability of our Kubernetes fleet on AWS, define and track SLOs, lead incident response, and mentor engineers. You have experience with Terraform, Prometheus and observability tooling. Nice to have: Datadog, OpenTelemetry. Our team values calm on-call, clear writing and a blameless culture.',
};

export const SRE_TERMS = ['Kubernetes', 'AWS', 'Terraform', 'Prometheus', 'Datadog', 'OpenTelemetry', 'SLOs', 'incident response'];

/** Sentences a real model writes, every claim in them on the résumé: all kept. */
export const SRE_HONEST = [
  'Reliability is the part of engineering I enjoy most, because it is where software meets the people who depend on it.',
  'Mentoring is something I take seriously: I mentored four junior engineers through their first on-call shifts at Northwind Logistics.',
  'Observability starts with alerts people trust, which is why I built Prometheus and Grafana alerting that cut pages by 35%.',
  "Your team's focus on calm on-call and a blameless culture matches how I already work.",
  'Thank you for considering my application.',
  'Building Python services for claims processing at Contoso Health taught me to respect data correctness.',
  "Fabrikam's work for regional freight carriers is close to what I do at Northwind Logistics.",
  "That's why I wrote runbooks and ran blameless postmortems for our on-call rotation.",
  'Clear writing matters during incidents, so I write runbooks that a tired engineer can follow.',
  'Curiosity drew me to infrastructure after years of building application code.',
  'Small, careful changes are how I migrated 40 services to Kubernetes on AWS EKS with Terraform.',
  'Customers notice outages before dashboards do, so I care about alerting on symptoms.',
  'Automation is a habit for me: I automated deploys with GitHub Actions, cutting release time from 2 hours to 20 minutes.',
  "It's the kind of role where my Kubernetes and Terraform experience would be useful from the first week.",
  'What draws me to Fabrikam is its blameless culture.',
  'Teamwork matters to me, and I defined SLOs for the shipment tracking API with product teams.',
  'Pragmatism guides my tooling choices, which is why I keep Terraform for every environment.',
  'Fabrikam is solving a problem I know well from shipment tracking at Northwind Logistics.',
  "I read about Fabrikam's routing software and it is close to the shipment tracking work I do.",
  'Most of my work is keeping Kubernetes on AWS boring, in the best sense.',
  'Ownership means I write the runbook before I hand over a service.',
  "Here's what I would bring: Kubernetes on AWS, Terraform, and Prometheus alerting people trust.",
  'Pages at night taught me to build alerting that cut pages by 35%.',
];

/** An honest Concise letter of 152 words: it must pass whole, well above the 75-word floor. */
export const SRE_LETTER = [
  "I'm applying for the Senior Site Reliability Engineer role at Fabrikam. Fabrikam's work for regional freight carriers is close to what I do at Northwind Logistics, where I keep Kubernetes on AWS healthy.",
  'Reliability starts with alerts people trust. At Northwind Logistics I built Prometheus and Grafana alerting that cut pages by 35%. Small, careful changes are how I migrated 40 services to Kubernetes on AWS EKS with Terraform. Ownership means I write the runbook before I hand over a service.',
  'Mentoring matters to me as well. I mentored four junior engineers through their first on-call shifts, and I ran blameless postmortems for the on-call rotation. Teamwork with product teams shaped the SLOs I defined for the shipment tracking API.',
  "What draws me to Fabrikam is its blameless culture and calm on-call. Here's what I would bring: Kubernetes on AWS, Terraform, and Prometheus alerting people trust. Thank you for considering my application.",
];

/** Ordinary words that open a sentence: "X is something I think about…". None is a name. */
export const OPENERS =
  'Excited Happy Glad Eager Grateful Honestly Sure Perhaps Ideally Instead Beyond Reach Attached Feel Collaboration Communication Security Data Cost Speed Quality Empathy Leadership Pride Patience Trust Simplicity Clarity Consistency Documentation Learning Shipping Engineers Startups Logistics Freight Outages Incidents Alerts Dashboards Uptime Latency Each Everyone Nobody Someone Anyone Whatever Rather Getting Joining'.split(
    ' ',
  );

/** Claims the résumé doesn't support, in the shapes that got past the check before: all dropped. */
export const SRE_INVENTED = [
  'My years at google taught me to build systems that scale.',
  'Before Northwind Logistics, I was on the infrastructure team at amazon.',
  'I consulted on routing for flexport before joining Northwind Logistics.',
  'Earlier, at netflix, I ran chaos experiments on Kubernetes.',
  'my team at stripe shipped the payments ledger on Kubernetes.',
  'I hold the CKA and keep it current.',
  'I reduced our AWS bill by a third with Terraform cleanups.',
  'I was promoted twice in two years at Northwind Logistics.',
  'I have ten years of experience keeping Kubernetes healthy.',
  'I was the on-call lead for the whole company.',
  'I speak fluent spanish and mandarin, which helps with global teams.',
  'Over a hundred engineers relied on the Kubernetes platform I ran.',
  'I owned the incident process for a fortune 500 retailer.',
  'I was employed by the federal reserve as a contractor.',
  'Previously I did contract work for uber on their Kubernetes fleet.',
  'I am a google-certified cloud architect.',
  'Fabrikam’s routing team and I worked together on a pilot.',
  'Fabrikam has been a customer of my consulting practice.',
  'I already know Fabrikam well, having run its Kubernetes fleet.',
  'Northwind Logistics acquired Fabrikam, so I know the codebase.',
  'I led a team of 12 engineers at Northwind Logistics.',
  'I hold a security clearance.',
  'I have an MBA from Wharton.',
  'I have a master’s in computer science.',
  // The first-word ties: the actor of a sentence that ties the candidate to it.
  'Google trained me as an engineer.',
  'Microsoft is where I learned Go.',
  'Netflix and Northwind Logistics both relied on my Kubernetes work.',
  'Amazon promoted me twice.',
  'Shopify taught me how to run Kubernetes at scale.',
  'Salesforce is the company where I first ran on-call.',
];
