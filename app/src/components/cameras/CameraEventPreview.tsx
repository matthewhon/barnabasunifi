'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type { Camera, CameraStreamSession } from '@/lib/types';
import { safeFormatDistanceToNow } from '@/lib/date-utils';

interface CameraEventPreviewProps {
  orgId: string;
  camera: Camera;
  fallbackPhoto?: string | null;
  fallbackCaption?: string;
}

export default function CameraEventPreview({
  orgId,
  camera,
  fallbackPhoto = null,
  fallbackCaption = 'No recent event',
}: CameraEventPreviewProps) {
  const [eventUrl, setEventUrl] = useState<string | null>(null);
  const [eventLabel, setEventLabel] = useState<string | null>(camera.last_event_label ?? null);
  const [eventAt, setEventAt] = useState<string | null>(camera.last_event_at ?? null);

  const loadEventSession = useCallback(async () => {
    try {
      const fn = httpsCallable<
        { orgId: string; cameraId: string; mode?: 'live' | 'event' },
        CameraStreamSession
      >(functions, 'issueCameraStreamSession');
      const res = await fn({ orgId, cameraId: camera.id, mode: 'event' });
      const data = res.data;
      setEventUrl(data.last_event_snapshot_url || null);
      if (data.last_event_label) setEventLabel(data.last_event_label);
      if (data.last_event_at) setEventAt(data.last_event_at);
    } catch {
      // Fallback gracefully if onsite-only or permission denied
      setEventUrl(null);
    }
  }, [orgId, camera.id]);

  useEffect(() => {
    void loadEventSession();
    const timer = setInterval(() => {
      void loadEventSession();
    }, 60_000);
    return () => clearInterval(timer);
  }, [loadEventSession, camera.last_event_at]);

  const imgSrc = eventUrl || fallbackPhoto;
  const captionText = eventLabel
    ? `${eventLabel}${eventAt ? ` · ${safeFormatDistanceToNow(eventAt)}` : ''}`
    : fallbackCaption;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        background: '#060911',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {imgSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imgSrc}
          alt={camera.name}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          loading="lazy"
        />
      ) : (
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          Waiting for next motion or door event…
        </span>
      )}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '0.3rem 0.5rem',
          background: 'rgba(10, 14, 23, 0.8)',
          color: '#e2e8f0',
          fontSize: '0.6875rem',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {captionText}
      </div>
    </div>
  );
}
