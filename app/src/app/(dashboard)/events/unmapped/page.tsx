'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function UnmappedEventsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/mappings?tab=unmapped');
  }, [router]);

  return (
    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
      Redirecting to Mappings &amp; Sync…
    </div>
  );
}
