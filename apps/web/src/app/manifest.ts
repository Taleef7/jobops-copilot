import type { MetadataRoute } from 'next';
import { PRODUCT_SENTENCE } from '@/lib/product';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'JobOps Copilot',
    short_name: 'JobOps',
    description: PRODUCT_SENTENCE,
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0e14',
    theme_color: '#059669',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
