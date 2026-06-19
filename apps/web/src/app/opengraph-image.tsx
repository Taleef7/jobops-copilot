import { ImageResponse } from 'next/og';

// Branded social-share card, used as both og:image and twitter:image.
export const alt = 'JobOps Copilot — AI Job Search Platform';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px',
          background: 'linear-gradient(135deg, #0b0e14 0%, #0c1a16 100%)',
          color: '#f8fafc',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: '#059669',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 38,
            }}
          >
            ⚡
          </div>
          <div style={{ fontSize: 30, fontWeight: 700 }}>JobOps Copilot</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05, maxWidth: 980 }}>
            Run your job search like an AI operations team.
          </div>
          <div style={{ fontSize: 30, color: '#94a3b8', maxWidth: 900 }}>
            Track roles, score fit with RAG, run multi-step agents — human-approved at every step.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, fontSize: 24, color: '#34d399' }}>
          <span>AI agents</span>
          <span style={{ color: '#475569' }}>·</span>
          <span>RAG fit scoring</span>
          <span style={{ color: '#475569' }}>·</span>
          <span>telemetry</span>
        </div>
      </div>
    ),
    size,
  );
}
