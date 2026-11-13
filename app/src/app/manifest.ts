import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Barnabas UniFi PCO Mobile',
    short_name: 'UniFi Doors',
    description: 'Open doors, manage visitors, and view upcoming schedules on mobile.',
    start_url: '/m',
    display: 'standalone',
    background_color: '#0f1117',
    theme_color: '#0f1117',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}
