'use client';

import React, { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Dashboard Error]:', error);
  }, [error]);

  return (
    <div style={{ padding: '2rem 1rem', maxWidth: '36rem', margin: '2rem auto' }}>
      <div className="card" style={{ padding: '2rem', textAlign: 'center', borderColor: 'var(--color-danger, #ef4444)' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⚠️</div>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', color: 'var(--color-text-primary)' }}>
          Something went wrong
        </h2>
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
          {error?.message || 'An unexpected error occurred while loading this section.'}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={() => reset()}
            className="btn-primary"
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: 'var(--radius-md, 6px)',
              background: 'var(--color-accent, #2563eb)',
              color: '#fff',
              border: 'none',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-secondary"
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: 'var(--radius-md, 6px)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
