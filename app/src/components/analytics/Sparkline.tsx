'use client';

import React from 'react';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = '#2465F5',
}: SparklineProps) {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data, min + 1);
  const padding = 2;

  const chartW = width - padding * 2;
  const chartH = height - padding * 2;

  const points = data.map((val, idx) => {
    const x = padding + (idx / (data.length - 1)) * chartW;
    const y = padding + chartH - ((val - min) / (max - min)) * chartH;
    return `${x},${y}`;
  });

  const pathD = points.reduce((acc, pt, idx) => (idx === 0 ? `M ${pt}` : `${acc} L ${pt}`), '');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
