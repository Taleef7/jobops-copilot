import { ImageResponse } from 'next/og';
import { PRODUCT_SENTENCE } from '@/lib/product';

// Social-share card: the name and the product sentence, nothing else (#356).
// Re-exported by app/twitter-image.tsx so the same card backs og:image and twitter:image.
export const alt = `JobOps Copilot: ${PRODUCT_SENTENCE}`;
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
          background: '#0b0e14',
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
            }}
          >
            {/* Inline SVG bolt — Satori does not reliably render emoji glyphs. */}
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l1-8Z" fill="#f8fafc" />
            </svg>
          </div>
          <div style={{ fontSize: 30, fontWeight: 700 }}>JobOps Copilot</div>
        </div>

        <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.15, maxWidth: 1000 }}>
          {PRODUCT_SENTENCE}
        </div>
      </div>
    ),
    size,
  );
}
