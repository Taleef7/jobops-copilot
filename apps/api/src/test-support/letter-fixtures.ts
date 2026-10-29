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

/*
 * The third review's corpus (#416): 50 invented claims and 48 honest sentences a real model
 * writes. Each finding is either dropped (deterministic: numbers, dates, links, credentials,
 * posting skills, placeholders) or flagged for the user to keep or remove (names, ties,
 * employers, languages, titles, leadership). No invented claim is kept unmarked.
 */

/** Invented claims: each dropped or flagged, never kept unmarked. */
export const REVIEW_INVENTED = [
  "Over three years at Initech, I kept Kubernetes healthy.",
  "My work at the startup Globex taught me to run lean on-call.",
  "I received the Engineer of the Year award at Northwind Logistics.",
  "I was named a Kubernetes Hero by the community last year.",
  "I cut our cloud spend by half with Terraform cleanups.",
  "I reduced alert noise by forty percent with Prometheus.",
  "I mentored a dozen interns through their first on-call shifts.",
  "I ran the on-call rotation for fifty engineers.",
  "I trained hundreds of engineers on Terraform.",
  "I won our internal hackathon twice.",
  "I passed the CKAD exam on my first attempt.",
  "I hold a black belt in Six Sigma.",
  "I led the platform team at Northwind Logistics.",
  "I managed the AWS budget for the whole engineering org.",
  "I founded the SRE guild at Northwind Logistics.",
  "I was the first SRE hire at a Series B startup.",
  "I was recognised with a peer award for incident leadership.",
  "I am an active maintainer of the Prometheus project.",
  "I sat on the Kubernetes steering committee for a term.",
  "Before Northwind Logistics I spent a year with the Wayne Enterprises cloud team.",
  "I scaled the Kubernetes fleet tenfold in a single quarter.",
  "I personally handled over a thousand incidents.",
  "Later I worked as a staff engineer for initech on payments.",
  "I joined initech straight out of college.",
  "Both Initech and Northwind Logistics relied on my Terraform modules.",
  "I worked at Grafana on the alerting team.",
  "I spent a summer at AWS on the EKS team.",
  "I interned with initech on their Kubernetes fleet.",
  "I partnered with globex on a Terraform migration.",
  "I contracted with initech on payments.",
  "Initech brought me on to fix their on-call.",
  "Initech was my first employer.",
  "Initech put me in charge of on-call.",
  "Initech let me run their Kubernetes fleet.",
  "Globex still calls me when their Kubernetes clusters break.",
  "Initech, my previous employer, ran everything on Kubernetes.",
  "I hold the Kubernetes Administrator credential.",
  "I scaled the platform fivefold.",
  "I cut costs threefold with Terraform.",
  "I am a published author on site reliability.",
  "I keynoted KubeCon last year.",
  "I spoke at kubecon about on-call.",
  "I was a speaker at kubecon in Pittsburgh.",
  "I won a hackathon at initech.",
  "Fabrikam interviewed me last year and I have stayed in touch.",
  "I have known Fabrikam since my consulting days.",
  "I know the team at Fabrikam well.",
  "Fabrikam used my Terraform modules in production.",
  "Fabrikam is a former client of mine.",
  "I once ran Fabrikam’s Kubernetes fleet as a contractor.",
  "Fabrikam's platform team was my client.",
  "Fabrikam's on-call tooling is something I built as a contractor.",
  "Fabrikam's routing engine was built by me.",
  "I talked to Fabrikam about their Kubernetes fleet when I consulted for them.",
];

/** Honest sentences: none dropped, few flagged. */
export const REVIEW_HONEST = [
  "Fabrikam's focus on regional freight carriers is what caught my eye.",
  "Northwind Logistics' shipment tracking API taught me why SLOs matter.",
  "I know Fabrikam builds routing software for freight carriers, which is close to my shipment tracking work.",
  "Having used Terraform for every environment, I can pick up Fabrikam's tooling quickly.",
  "I helped product teams define SLOs, the same work Fabrikam's posting describes.",
  "I built Prometheus and Grafana alerting that cut pages by 35%, the kind of work Fabrikam's team describes.",
  "\"Blameless\" is a word I take literally when I run postmortems.",
  "My team at Northwind Logistics relies on the alerting I built with Prometheus and Grafana.",
  "Grafana dashboards and Prometheus alerts are where I spend most of my day.",
  "Python, Go and Terraform are the tools I reach for first.",
  "s line about \"calm on-call\" is exactly how I run the rotation.",
  "Fabrikam serves regional freight carriers, much like the shipment tracking I support at Northwind Logistics.",
  "Like Fabrikam, I believe on-call should be calm and postmortems blameless.",
  "What excites me about Fabrikam is its blameless culture, which matches how I ran postmortems at Northwind Logistics.",
  "Since 2021 I have kept Kubernetes on AWS healthy at Northwind Logistics.",
  "Before Northwind Logistics, I built Python services for claims processing at Contoso Health.",
  "I was praised by the product teams for the SLOs we defined together.",
  "My work at the shipment tracking team taught me to write SLOs people use.",
  "I spent my first years at Contoso Health building Python services on PostgreSQL.",
  "Fabrikam's routing software, like the shipment tracking API I worked on, depends on calm on-call.",
  "Information Systems at Carnegie Mellon University is where I learned to write clear documentation.",
  "Contoso Health is where I learned to automate deploys with GitHub Actions.",
  "I worked closely with product teams to define SLOs for the shipment tracking API.",
  "Grafana is where I built the alerting that cut pages by 35%.",
  "I've maintained Terraform for every environment, and I'd love to do the same at Fabrikam.",
  "I was mentored by senior engineers when I started at Contoso Health.",
  "I was trusted by customers to keep shipment tracking up.",
  "I was responsible for alerting at Northwind Logistics.",
  "I was on call for nights at a time, which is why I built alerting that cut pages by 35%.",
  "In practice, at minimum, I write a runbook before I hand over a service.",
  "I was surprised by how much calmer on-call became after we cut pages by 35%.",
  "I worked for months on the Kubernetes migration at Northwind Logistics.",
  "I worked closely for product teams on SLOs at Northwind Logistics.",
  "My time with postmortems taught me to write clearly.",
  "I was drawn to infrastructure by curiosity.",
  "I was hired for my Python work at Contoso Health.",
  "I joined forces with product teams to define SLOs.",
  "I was motivated by outages at night.",
  "I spent weekends at hackathons learning Go.",
  "I worked on call for years before I built better alerting.",
  "Curiosity taught me to read every postmortem closely.",
  "Experience taught me that runbooks matter more than heroics.",
  "Observability is where I spend most of my time on call.",
  "Mentorship gave me as much as it gave the four junior engineers I mentored.",
  "Burnout on the on-call rotation taught me to cut pages by 35%.",
  "Patience and practice taught me to migrate services one at a time.",
  "Late-night pages taught me to write runbooks.",
  "Automation is where I started, with GitHub Actions deploys at Contoso Health.",
  "I doubled down on runbooks after a rough on-call week.",
];

/** Links and addresses: only the candidate's own address, in any case, is kept. */
export const REVIEW_LINKS = [
  "You can email me at mailto:raman@evil.com any time.",
  "You can reach me at raman@evil.com/ any time.",
  "You can reach me at priyaraman.NET any time.",
  "My Kubernetes notes are at priyaraman.sh for anyone to read.",
  "You can reach me at räman@evil.com any time.",
  "My work is at github.com/priya-raman.",
  "You can reach me at Priya.Raman@Example.com any time.",
  "You can reach me at priya.raman@example.com.au any time.",
];
