'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type { Camera, CameraStreamSession } from '@/lib/types';
import { Video, VideoOff, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react';

interface CameraPlayerProps {
  orgId: string;
  camera: Camera;
  compact?: boolean;
  onSessionLoaded?: (session: CameraStreamSession) => void;
}

export default function CameraPlayer({
  orgId,
  camera,
  compact = false,
  onSessionLoaded,
}: CameraPlayerProps) {
  const [session, setSession] = useState<CameraStreamSession | null>(null);
  const [snapshotSrc, setSnapshotSrc] = useState<string | null>(null);
  const [webrtcActive, setWebrtcActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState<'ONSITE_REQUIRED' | 'DENIED' | 'ERROR' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const fetchSession = useCallback(async () => {
    try {
      const fn = httpsCallable<
        { orgId: string; cameraId: string },
        CameraStreamSession
      >(functions, 'issueCameraStreamSession');
      const res = await fn({ orgId, cameraId: camera.id });
      const data = res.data;
      setSession(data);
      setErrorCode(null);
      setErrorMessage(null);
      if (data.snapshot_url) {
        setSnapshotSrc(data.snapshot_url);
      }
      onSessionLoaded?.(data);
      return data;
    } catch (err: any) {
      const msg = String(err?.message || 'Unable to load camera stream');
      if (msg.includes('ONSITE_REQUIRED')) {
        setErrorCode('ONSITE_REQUIRED');
        setErrorMessage('Onsite access required — connect to the church network to view this camera.');
      } else if (err?.code === 'functions/permission-denied' || msg.includes('permission')) {
        setErrorCode('DENIED');
        setErrorMessage('You do not have permission to view this camera.');
      } else {
        setErrorCode('ERROR');
        setErrorMessage(msg);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [orgId, camera.id, onSessionLoaded]);

  // Attempt WebRTC (WHEP) if webrtc_url is provided; gracefully fall back to snapshots
  const startWebRtcIfAvailable = useCallback(async (webrtcUrl: string) => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pcRef.current = pc;
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          setWebrtcActive(true);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const resp = await fetch(webrtcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        throw new Error(`WebRTC handshake returned ${resp.status}`);
      }
      const answerSdp = await resp.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch {
      setWebrtcActive(false);
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const init = async () => {
      const s = await fetchSession();
      if (cancelled || !s) return;

      if (s.webrtc_url && (s.stream_mode === 'webrtc_lan' || s.stream_mode === 'relay')) {
        await startWebRtcIfAvailable(s.webrtc_url);
      }

      // Poll snapshot / renew viewer lease
      const intervalMs = webrtcActive ? 30_000 : 3000;
      pollTimer = setInterval(() => {
        if (!cancelled) {
          void fetchSession();
        }
      }, intervalMs);
    };

    void init();

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    };
  }, [fetchSession, startWebRtcIfAvailable, webrtcActive]);

  if (loading) {
    return (
      <div
        style={{
          aspectRatio: '16 / 9',
          background: '#0b0f19',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          color: 'var(--color-text-muted)',
          fontSize: '0.8rem',
        }}
      >
        <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite' }} />
        <span>Connecting to {camera.name}…</span>
      </div>
    );
  }

  if (errorCode === 'ONSITE_REQUIRED') {
    return (
      <div
        style={{
          aspectRatio: '16 / 9',
          background: '#0b0f19',
          borderRadius: 'var(--radius-md)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          textAlign: 'center',
          gap: '0.5rem',
        }}
      >
        <WifiOff size={24} color="#f59e0b" />
        <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#fbbf24' }}>
          Onsite Access Required
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', maxWidth: '22rem' }}>
          {errorMessage}
        </div>
      </div>
    );
  }

  if (errorCode === 'DENIED' || errorCode === 'ERROR') {
    return (
      <div
        style={{
          aspectRatio: '16 / 9',
          background: '#0b0f19',
          borderRadius: 'var(--radius-md)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          textAlign: 'center',
          gap: '0.5rem',
        }}
      >
        <ShieldAlert size={24} color="#ef4444" />
        <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#f87171' }}>
          {errorCode === 'DENIED' ? 'Access Restricted' : 'Stream Unavailable'}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', maxWidth: '22rem' }}>
          {errorMessage}
        </div>
      </div>
    );
  }

  const isOffline = camera.state !== 'CONNECTED';

  return (
    <div
      style={{
        position: 'relative',
        aspectRatio: '16 / 9',
        background: '#060911',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        border: '1px solid var(--color-border)',
      }}
    >
      {webrtcActive ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      ) : snapshotSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={snapshotSrc}
          alt={camera.name}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            color: 'var(--color-text-muted)',
            fontSize: '0.8rem',
          }}
        >
          {isOffline ? <VideoOff size={24} /> : <Video size={24} />}
          <span>{isOffline ? 'Camera Offline' : 'Waiting for first frame from agent…'}</span>
        </div>
      )}

      {/* Top overlay status */}
      <div
        style={{
          position: 'absolute',
          top: '0.5rem',
          left: '0.5rem',
          right: '0.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.2rem 0.5rem',
            borderRadius: '9999px',
            fontSize: '0.7rem',
            fontWeight: 600,
            background: 'rgba(10, 14, 23, 0.78)',
            color: isOffline ? '#f87171' : '#34d399',
            backdropFilter: 'blur(4px)',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: isOffline ? '#ef4444' : '#10b981',
            }}
          />
          {webrtcActive ? 'LIVE' : isOffline ? 'OFFLINE' : 'LIVE SNAPSHOT'}
        </span>

        {!compact && session && !session.allow_notifications && (
          <span
            style={{
              padding: '0.2rem 0.5rem',
              borderRadius: '9999px',
              fontSize: '0.68rem',
              fontWeight: 500,
              background: 'rgba(10, 14, 23, 0.78)',
              color: 'var(--color-text-muted)',
              backdropFilter: 'blur(4px)',
            }}
          >
            Live View Only
          </span>
        )}
      </div>
    </div>
  );
}
