'use client';

import React, { useState } from 'react';

export interface AreaDataPoint {
  label: string;
  value: number;
  secondaryValue?: number;
  subLabel?: string;
}

interface AreaChartProps {
  data: AreaDataPoint[];
  height?: number;
  color?: string;
  secondaryColor?: string;
  valuePrefix?: string;
  valueSuffix?: string;
  secondaryLabel?: string;
  primaryLabel?: string;
  emptyMessage?: string;
}

export function AreaChart({
  data,
  height = 220,
  color = '#2465F5',
  secondaryColor = '#10b981',
  valuePrefix = '',
  valueSuffix = '',
  primaryLabel = 'Access Events',
  secondaryLabel,
  emptyMessage = 'No data available for the selected period',
}: AreaChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
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

  const paddingLeft = 36;
  const paddingRight = 16;
  const paddingTop = 20;
  const paddingBottom = 30;
  const width = 600; // viewBox units

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const maxVal = Math.max(
    1,
    ...data.map((d) => Math.max(d.value, d.secondaryValue ?? 0))
  );

  // Calculate points
  const points = data.map((d, i) => {
    const x = paddingLeft + (i / Math.max(1, data.length - 1)) * chartWidth;
    const y = paddingTop + chartHeight - (d.value / maxVal) * chartHeight;
    return { x, y, data: d };
  });

  // SVG path for line
  const linePath = points.reduce((acc, pt, idx, arr) => {
    if (idx === 0) return `M ${pt.x},${pt.y}`;
    const prev = arr[idx - 1];
    const cx1 = prev.x + (pt.x - prev.x) / 3;
    const cy1 = prev.y;
    const cx2 = pt.x - (pt.x - prev.x) / 3;
    const cy2 = pt.y;
    return `${acc} C ${cx1},${cy1} ${cx2},${cy2} ${pt.x},${pt.y}`;
  }, '');

  // SVG path for gradient area
  const areaPath = `${linePath} L ${points[points.length - 1].x},${paddingTop + chartHeight} L ${points[0].x},${paddingTop + chartHeight} Z`;

  // Secondary line/area if provided
  let secondaryLinePath = '';
  let secondaryAreaPath = '';
  if (secondaryLabel) {
    const secPoints = data.map((d, i) => {
      const x = paddingLeft + (i / Math.max(1, data.length - 1)) * chartWidth;
      const y = paddingTop + chartHeight - ((d.secondaryValue ?? 0) / maxVal) * chartHeight;
      return { x, y };
    });
    secondaryLinePath = secPoints.reduce((acc, pt, idx, arr) => {
      if (idx === 0) return `M ${pt.x},${pt.y}`;
      const prev = arr[idx - 1];
      const cx1 = prev.x + (pt.x - prev.x) / 3;
      const cy1 = prev.y;
      const cx2 = pt.x - (pt.x - prev.x) / 3;
      const cy2 = pt.y;
      return `${acc} C ${cx1},${cy1} ${cx2},${cy2} ${pt.x},${pt.y}`;
    }, '');
    secondaryAreaPath = `${secondaryLinePath} L ${secPoints[secPoints.length - 1].x},${paddingTop + chartHeight} L ${secPoints[0].x},${paddingTop + chartHeight} Z`;
  }

  // Y-axis gridlines (4 steps)
  const gridSteps = [0, 0.25, 0.5, 0.75, 1];

  const activePoint = hoveredIdx !== null && points[hoveredIdx] ? points[hoveredIdx] : null;

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
        onMouseLeave={() => setHoveredIdx(null)}
      >
        <defs>
          <linearGradient id={`areaGrad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
          {secondaryLabel && (
            <linearGradient id={`areaGradSec-${secondaryColor.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={secondaryColor} stopOpacity="0.25" />
              <stop offset="100%" stopColor={secondaryColor} stopOpacity="0.0" />
            </linearGradient>
          )}
        </defs>

        {/* Horizontal grid lines */}
        {gridSteps.map((step, i) => {
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
                opacity="0.6"
              />
              <text
                x={paddingLeft - 8}
                y={y + 4}
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

        {/* Secondary Area & Line */}
        {secondaryLabel && secondaryAreaPath && (
          <>
            <path d={secondaryAreaPath} fill={`url(#areaGradSec-${secondaryColor.replace('#', '')})`} />
            <path d={secondaryLinePath} fill="none" stroke={secondaryColor} strokeWidth="2" strokeDasharray="4 4" />
          </>
        )}

        {/* Primary Area & Line */}
        <path d={areaPath} fill={`url(#areaGrad-${color.replace('#', '')})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />

        {/* Hover interaction points */}
        {points.map((pt, idx) => (
          <g key={idx}>
            <circle
              cx={pt.x}
              cy={pt.y}
              r={hoveredIdx === idx ? 5 : 3}
              fill={hoveredIdx === idx ? '#fff' : color}
              stroke={color}
              strokeWidth={hoveredIdx === idx ? 2.5 : 1}
              style={{ transition: 'all 0.15s ease', cursor: 'pointer' }}
              onMouseEnter={() => setHoveredIdx(idx)}
            />
            {/* Invisible larger hover hit area */}
            <rect
              x={pt.x - chartWidth / (data.length * 2)}
              y={paddingTop}
              width={chartWidth / data.length}
              height={chartHeight}
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredIdx(idx)}
            />
          </g>
        ))}

        {/* Active hover guideline */}
        {activePoint && (
          <line
            x1={activePoint.x}
            y1={paddingTop}
            x2={activePoint.x}
            y2={paddingTop + chartHeight}
            stroke={color}
            strokeWidth="1"
            strokeDasharray="2 2"
            opacity="0.8"
          />
        )}

        {/* X-axis labels (sampled to max ~7) */}
        {points.map((pt, idx) => {
          const step = Math.max(1, Math.floor(points.length / 7));
          const showLabel = idx % step === 0 || idx === points.length - 1;
          if (!showLabel) return null;
          return (
            <text
              key={idx}
              x={pt.x}
              y={height - 8}
              textAnchor="middle"
              fontSize="10"
              fill="var(--color-text-muted)"
              fontFamily="inherit"
            >
              {pt.data.label}
            </text>
          );
        })}
      </svg>

      {/* Floating Tooltip */}
      {activePoint && (
        <div
          style={{
            position: 'absolute',
            left: `${(activePoint.x / width) * 100}%`,
            top: `${(activePoint.y / height) * 100}%`,
            transform: 'translate(-50%, -120%)',
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.4rem 0.65rem',
            pointerEvents: 'none',
            zIndex: 10,
            whiteSpace: 'nowrap',
            fontSize: '0.75rem',
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {activePoint.data.label} {activePoint.data.subLabel ? `(${activePoint.data.subLabel})` : ''}
          </div>
          <div style={{ color, display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
            <span>{primaryLabel}: <strong>{valuePrefix}{activePoint.data.value.toLocaleString()}{valueSuffix}</strong></span>
          </div>
          {secondaryLabel && activePoint.data.secondaryValue !== undefined && (
            <div style={{ color: secondaryColor, display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.15rem' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: secondaryColor }} />
              <span>{secondaryLabel}: <strong>{valuePrefix}{activePoint.data.secondaryValue.toLocaleString()}{valueSuffix}</strong></span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
