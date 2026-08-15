'use client';

import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  label?: string;
  centered?: boolean;
}

const SIZE_MAP = {
  sm: '1.25rem',
  md: '2rem',
  lg: '3rem',
} as const;

const BORDER_MAP = {
  sm: '2px',
  md: '3px',
  lg: '4px',
} as const;

export default function LoadingSpinner({
  size = 'md',
  color = 'var(--color-accent)',
  label = 'Loading…',
  centered = false,
}: LoadingSpinnerProps) {
  const dimension = SIZE_MAP[size];
  const border = BORDER_MAP[size];

  const spinner = (
    <div
      role="status"
      aria-label={label}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.625rem',
      }}
    >
      <div
        style={{
          width: dimension,
          height: dimension,
          border: `${border} solid var(--color-border)`,
          borderTopColor: color,
          borderRadius: '50%',
          animation: 'spinner-rotate 0.75s linear infinite',
          flexShrink: 0,
        }}
      />
      {label && (
        <span className="sr-only">{label}</span>
      )}
      <style>{`
        @keyframes spinner-rotate {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );

  if (centered) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          padding: '3rem',
        }}
      >
        {spinner}
      </div>
    );
  }

  return spinner;
}
