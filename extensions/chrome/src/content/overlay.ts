import type { ApplicationPackPayload, MatchedJobRecord } from '../types';

export class ContentOverlay {
  private container: HTMLDivElement | null = null;
  private onAutofillCallback: (() => void) | null = null;

  constructor(onAutofill: () => void) {
    this.onAutofillCallback = onAutofill;
  }

  mount(doc: Document = document): void {
    if (doc.getElementById('jobops-overlay-root')) return;

    this.container = doc.createElement('div');
    this.container.id = 'jobops-overlay-root';
    doc.body.appendChild(this.container);
    this.renderPill('JobOps Copilot', 'Ready');
  }

  showMatchedJob(job: MatchedJobRecord, pack?: ApplicationPackPayload | null): void {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="jobops-banner">
        <div class="jobops-banner-header">
          <div class="jobops-banner-title">
            <span class="jobops-logo-dot"></span>
            JobOps Copilot
          </div>
          <button class="jobops-banner-close" title="Dismiss" aria-label="Dismiss">&times;</button>
        </div>
        <div>
          <div class="jobops-banner-job">${job.title}</div>
          <div class="jobops-banner-company">${job.company}</div>
        </div>
        <div class="jobops-banner-status">
          ${pack ? `Application Pack: ${pack.answers?.length || 0} answers ready` : 'Profile ready'}
        </div>
        <button id="jobops-overlay-autofill-btn" class="jobops-pill-action" style="padding: 7px 12px; font-size: 12px;">
          ⚡ Autofill Form
        </button>
      </div>
    `;

    const closeBtn = this.container.querySelector('.jobops-banner-close');
    closeBtn?.addEventListener('click', () => {
      this.renderPill(job.company, 'Autofill');
    });

    const autofillBtn = this.container.querySelector('#jobops-overlay-autofill-btn');
    autofillBtn?.addEventListener('click', () => {
      if (this.onAutofillCallback) this.onAutofillCallback();
    });
  }

  showResult(filledCount: number, flaggedCount: number): void {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="jobops-pill">
        <span class="jobops-logo-dot"></span>
        <span class="jobops-pill-text">✓ Filled ${filledCount} fields${flaggedCount > 0 ? ` (${flaggedCount} flagged)` : ''}</span>
      </div>
    `;
  }

  showSubmissionCaptured(): void {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="jobops-pill" style="border-color: #10b981;">
        <span class="jobops-logo-dot"></span>
        <span class="jobops-pill-text">🎉 Submission Captured to JobOps CRM!</span>
      </div>
    `;
  }

  private renderPill(title: string, actionLabel: string): void {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="jobops-pill">
        <span class="jobops-logo-dot"></span>
        <span class="jobops-pill-text">${title}</span>
        <button id="jobops-pill-action-btn" class="jobops-pill-action">${actionLabel}</button>
      </div>
    `;

    const actionBtn = this.container.querySelector('#jobops-pill-action-btn');
    actionBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onAutofillCallback) this.onAutofillCallback();
    });
  }

  destroy(): void {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
      this.container = null;
    }
  }
}
