'use client';

import React, { useState } from 'react';

export interface BarDataPoint {
  label: string;
  value: number;
  secondaryValue?: number;
  subLabel?: string;
  color?: string;
}

interface BarChartProps {
  data: BarDataPoint[];
  height?: number;
  color?: string;
  horizontal?: boolean;
  valuePrefix?: string;
  valueSuffix?: string;
  emptyMessage?: string;
  maxBars?: number;
}

export function BarChart({
  data,
  height = 200,
  color = '#2465F5',
  horizontal = false,
  valuePrefix = '',
  valueSuffix = '',
  emptyMessage = 'No data available',
  maxBars = 10,
}: BarChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const displayData = data.slice(0, maxBars);

  if (!displayData || displayData.length === 0) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-muted)',
          fontSize: '0.875rem',
          border: '1px dashed var(--color-border)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  const maxVal = Math.max(1, ...displayData.map((d) => d.value));

  // ─── Horizontal Bar Chart ──────────────────────────────────────────────────
  if (horizontal) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', width: '100%' }}>
        {displayData.map((item, idx) => {
          const pct = Math.max(2, (item.value / maxVal) * 100);
          const barColor = item.color || color;
          const isHovered = hoveredIdx === idx;

          return (
            <div
              key={idx}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
                cursor: 'pointer',
                transition: 'opacity 0.15s ease',
                opacity: hoveredIdx !== null && !isHovered ? 0.6 : 1,
              }}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.8125rem',
                }}
              >
                <span
                  style={{
                    fontWeight: 500,
                    color: 'var(--color-text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '75%',
                  }}
                  title={item.label}
                >
                  {item.label}
                  {item.subLabel && (
                    <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', marginLeft: '0.35rem' }}>
                      ({item.subLabel})
                    </span>
                  )}
                </span>
                <span style={{ fontWeight: 600, color: barColor, fontSize: '0.8125rem' }}>
                  {valuePrefix}{item.value.toLocaleString()}{valueSuffix}
                </span>
              </div>
              <div
                style={{
                  width: '100%',
                  height: '0.5rem',
                  background: 'rgba(255, 255, 255, 0.06)',
                  borderRadius: '999px',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: barColor,
                    borderRadius: '999px',
                    transition: 'width 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ─── Vertical Column Chart ─────────────────────────────────────────────────
  const paddingLeft = 32;
  const paddingRight = 16;
  const paddingTop = 16;
  const paddingBottom = 28;
  const width = 500;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  const barWidth = Math.min(32, (chartWidth / displayData.length) * 0.65);
  const gap = chartWidth / displayData.length;

  const activeItem = hoveredIdx !== null ? displayData[hoveredIdx] : null;

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
        onMouseLeave={() => setHoveredIdx(null)}
      >
        {/* Horizontal grid lines */}
        {[0, 0.33, 0.66, 1].map((step, i) => {
          const y = paddingTop + chartHeight - step * chartHeight;
          const val = Math.round(step * maxVal);
          return (
            <g key={i}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={width - paddingRight}
                y2={y}
                stroke="var(--color-border)"
                strokeDasharray="3 3"
                strokeWidth="1"
                opacity="0.5"
              />
              <text
                x={paddingLeft - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="10"
                fill="var(--color-text-muted)"
                fontFamily="inherit"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {displayData.map((item, idx) => {
          const barHeight = Math.max(2, (item.value / maxVal) * chartHeight);
          const x = paddingLeft + idx * gap + (gap - barWidth) / 2;
          const y = paddingTop + chartHeight - barHeight;
          const barColor = item.color || color;
          const isHovered = hoveredIdx === idx;

          return (
            <g
              key={idx}
              onMouseEnter={() => setHoveredIdx(idx)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx="3"
                ry="3"
                fill={barColor}
                opacity={hoveredIdx === null || isHovered ? 1 : 0.45}
                style={{ transition: 'opacity 0.15s ease' }}
              />
              {/* X label */}
              <text
                x={x + barWidth / 2}
                y={height - 8}
                textAnchor="middle"
                fontSize="10"
                fill={isHovered ? 'var(--color-text-primary)' : 'var(--color-text-muted)'}
                fontWeight={isHovered ? 600 : 400}
                fontFamily="inherit"
              >
                {item.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Hover tooltip */}
      {activeItem && hoveredIdx !== null && (
        <div
          style={{
            position: 'absolute',
            left: `${((paddingLeft + hoveredIdx * gap + gap / 2) / width) * 100}%`,
            top: '0%',
            transform: 'translate(-50%, -100%)',
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.35rem 0.6rem',
            pointerEvents: 'none',
            zIndex: 10,
            whiteSpace: 'nowrap',
            fontSize: '0.75rem',
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{activeItem.label}</div>
          <div style={{ color: activeItem.color || color, fontWeight: 700 }}>
            {valuePrefix}{activeItem.value.toLocaleString()}{valueSuffix}
          </div>
        </div>
      )}
    </div>
  );
}
