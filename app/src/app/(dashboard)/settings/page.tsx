'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getOrgSettings, updateOrgSettings } from '@/lib/firestore';
import type { OrgSettings } from '@/lib/types';
import { useToast } from '@/components/ui/Toast';

// ─── Constants ────────────────────────────────────────────────────────────────

const US_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Phoenix', label: 'Mountain Time — Arizona (no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' },
  { value: 'America/Puerto_Rico', label: 'Atlantic Time (AT)' },
];

// ─── Icons ────────────────────────────────────────────────────────────────────

function CheckCircleIcon({ color = 'var(--color-success)' }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card section" style={{ margin: 0 }}>
      <h2
        style={{
          fontSize: '1rem',
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          marginBottom: '1.25rem',
          paddingBottom: '0.875rem',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

// ─── Slider + Number Input Row ────────────────────────────────────────────────

function SliderInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = 'minutes',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}) {
  return (
    <div className="form-group">
      <label className="form-label">
        {label}{' '}
        <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
          {value} {unit}
        </span>
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <input
          type="number"
          className="form-input"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
          style={{ width: '5rem', textAlign: 'center' }}
        />
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { orgId } = useAuth();
  const { showToast } = useToast();

  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [loading, setLoading] = useState(true);

  // Local form state
  const [unlockBuffer, setUnlockBuffer] = useState(15);
  const [lockBuffer, setLockBuffer] = useState(15);
  const [pollInterval, setPollInterval] = useState(30);
  const [timezone, setTimezone] = useState('America/Chicago');
  const [saving, setSaving] = useState(false);

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    getOrgSettings(orgId).then((s) => {
      setSettings(s);
      if (s) {
        setUnlockBuffer(s.unlock_buffer_before_min);
        setLockBuffer(s.lock_buffer_after_min);
        setPollInterval(s.poll_interval_min);
        setTimezone(s.timezone ?? 'America/Chicago');
      }
      setLoading(false);
    });
  }, [orgId]);

  const handleSaveTimings = useCallback(async () => {
    if (!orgId) return;
    setSaving(true);
    try {
      await updateOrgSettings(orgId, {
        unlock_buffer_before_min: unlockBuffer,
        lock_buffer_after_min: lockBuffer,
        poll_interval_min: pollInterval,
        timezone,
      });
      showToast('Settings saved successfully.', 'success');
    } catch {
      showToast('Failed to save settings. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  }, [orgId, unlockBuffer, lockBuffer, pollInterval, timezone, showToast]);

  async function handleDisconnectPco() {
    if (!orgId) return;
    try {
      await updateOrgSettings(orgId, {
        pco_oauth: undefined,
      } as Partial<OrgSettings>);
      setSettings((prev) => (prev ? { ...prev, pco_oauth: undefined } : prev));
      showToast('Planning Center disconnected.', 'info');
    } catch {
      showToast('Failed to disconnect. Please try again.', 'error');
    }
  }

  async function copyEnvSnippet() {
    const snippet = [
      `ORG_ID=${orgId ?? '<your-org-id>'}`,
      `FIREBASE_PROJECT_ID=${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '<project-id>'}`,
      `UNIFI_HOST=https://<your-unifi-controller>`,
      `UNIFI_USERNAME=<service-account>`,
      `UNIFI_PASSWORD=<service-account-password>`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Failed to copy to clipboard.', 'error');
    }
  }

  const isPcoConnected = !!settings?.pco_oauth?.access_token;

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Settings</h1>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton card" style={{ height: '12rem' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* ── 1. Planning Center Connection ── */}
        <SectionCard title="Planning Center Connection">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
            {isPcoConnected ? (
              <CheckCircleIcon />
            ) : (
              <XCircleIcon />
            )}
            <div>
              <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {isPcoConnected
                  ? settings?.pco_oauth?.pco_org_name ?? 'Connected'
                  : 'Not Connected'}
              </div>
              {isPcoConnected && (
                <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
                  Token expires:{' '}
                  {settings?.pco_oauth?.expires_at
                    ? new Date(settings.pco_oauth.expires_at).toLocaleString()
                    : '—'}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {isPcoConnected ? (
              <button className="btn btn-danger btn-sm" onClick={handleDisconnectPco}>
                Disconnect
              </button>
            ) : (
              <a href={`/api/pco/auth?orgId=${orgId}`} className="btn btn-primary btn-sm">
                Connect Planning Center
              </a>
            )}
          </div>
        </SectionCard>

        {/* ── 2. Timing Configuration ── */}
        <SectionCard title="Timing Configuration">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <SliderInput
              label="Unlock Buffer Before Event"
              value={unlockBuffer}
              onChange={setUnlockBuffer}
              min={0}
              max={120}
              step={5}
            />
            <SliderInput
              label="Lock Buffer After Event"
              value={lockBuffer}
              onChange={setLockBuffer}
              min={0}
              max={120}
              step={5}
            />
            <div className="form-group">
              <label className="form-label">
                Poll Interval{' '}
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  {pollInterval} minutes
                </span>
              </label>
              <input
                type="number"
                className="form-input"
                min={5}
                max={120}
                value={pollInterval}
                onChange={(e) => setPollInterval(Math.max(5, Math.min(120, Number(e.target.value))))}
                style={{ maxWidth: '8rem' }}
              />
              <span className="form-hint">How often the system syncs with Planning Center (5–120 min).</span>
            </div>

            <div className="form-group">
              <label className="form-label">Timezone</label>
              <select
                className="form-select"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                style={{ maxWidth: '22rem' }}
              >
                {US_TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
              <span className="form-hint">
                All schedule windows will be displayed in this timezone.
              </span>
            </div>

            <div>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveTimings}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </div>
        </SectionCard>

        {/* ── 3. Local Agent Setup ── */}
        <SectionCard title="Local Agent Setup">
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9375rem', marginBottom: '1.25rem', lineHeight: 1.6 }}>
            The local agent runs on a machine inside your network with access to the UniFi controller.
            It polls for door commands from Firestore and executes them via the UniFi Access API.
          </p>

          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="form-label">Organization ID</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                className="form-input"
                value={orgId ?? '—'}
                readOnly
                style={{ fontFamily: 'monospace', fontSize: '0.875rem', flex: 1 }}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <label className="form-label" style={{ margin: 0 }}>Agent .env snippet</label>
              <button
                className="btn btn-secondary btn-sm"
                onClick={copyEnvSnippet}
              >
                <CopyIcon />
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre style={{ margin: 0 }}>{`ORG_ID=${orgId ?? '<your-org-id>'}
FIREBASE_PROJECT_ID=${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '<project-id>'}
UNIFI_HOST=https://<your-unifi-controller>
UNIFI_USERNAME=<service-account>
UNIFI_PASSWORD=<service-account-password>`}</pre>
          </div>

          <div className="alert alert-info">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>
              See the{' '}
              <a
                href="https://github.com/your-org/unifi-pco/blob/main/agent/README.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                agent README
              </a>{' '}
              for full setup instructions including Docker deployment.
            </span>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
