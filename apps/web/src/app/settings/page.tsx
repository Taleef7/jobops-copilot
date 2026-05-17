import type { Metadata } from 'next';
import { SectionCard } from '@/components/section-card';

export const metadata: Metadata = {
  title: 'Settings',
};

export default function SettingsPage() {
  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">Configuration</p>
        <h2 className="hero__title">Settings that will eventually govern the whole job-search workflow.</h2>
        <p className="hero__lead">
          Even in foundation mode, the app already names the controls it will need for model
          providers, target roles, data sources, and automation wiring.
        </p>
      </section>

      <div className="grid grid--two">
        <SectionCard title="Target profile" description="The user-specific search focus.">
          <div className="stack">
            <div className="detail-card">
              <p className="detail-card__title">Target role</p>
              <p className="detail-card__value">AI automation and operations tooling</p>
            </div>
            <div className="detail-card">
              <p className="detail-card__title">Preferred locations</p>
              <p className="detail-card__value">Remote, hybrid, and selective on-site roles</p>
            </div>
            <div className="detail-card">
              <p className="detail-card__title">Resume source</p>
              <p className="detail-card__value">Uploaded resume PDF and profile summary text</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Platform status" description="What the stack expects to be configured later.">
          <div className="stack">
            <div className="detail-card">
              <p className="detail-card__title">LLM provider</p>
              <p className="detail-card__value">Mock mode until an API key is configured</p>
            </div>
            <div className="detail-card">
              <p className="detail-card__title">Azure storage</p>
              <p className="detail-card__value">Blob container reserved for resumes and weekly reports</p>
            </div>
            <div className="detail-card">
              <p className="detail-card__title">Automation webhooks</p>
              <p className="detail-card__value">n8n, Zapier, and Make connections will be documented in Phase 4</p>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Safety rules" description="The product is intentionally not an auto-apply bot.">
        <ul className="list">
          <li>Drafts can be generated, but sending always requires approval.</li>
          <li>Resume tailoring suggestions must remain truthful and auditable.</li>
          <li>Public-facing workflows should never expose API keys or private resume data.</li>
          <li>Automations should improve follow-up discipline, not spam recruiters.</li>
        </ul>
      </SectionCard>
    </div>
  );
}
