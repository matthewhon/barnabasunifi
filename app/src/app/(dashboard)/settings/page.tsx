'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
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
  const [testingPco, setTestingPco] = useState(false);
  const [testingUnifi, setTestingUnifi] = useState(false);

  const [copied, setCopied] = useState(false);

  const handleTestPcoConnection = async () => {
    if (!orgId) return;
    setTestingPco(true);
    try {
      const fn = httpsCallable<{ orgId: string }, { success: boolean; message: string }>(
        functions,
        'testPcoConnection'
      );
      const { data } = await fn({ orgId });
      showToast(data.message, data.success ? 'success' : 'error');
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      const msg = (e?.code === 'functions/internal' || e?.message === 'INTERNAL' || e?.code === 'functions/not-found')
        ? 'Connection test function is not deployed to Firebase yet. Please run "npx firebase-tools deploy --only functions".'
        : (e?.message ?? 'Planning Center connection test failed.');
      showToast(msg, 'error');
    } finally {
      setTestingPco(false);
    }
  };

  const handleTestUnifiConnection = async () => {
    if (!orgId) return;
    setTestingUnifi(true);
    try {
      const fn = httpsCallable<{ orgId: string }, { success: boolean; message: string }>(
        functions,
        'testUnifiConnection'
      );
      const { data } = await fn({ orgId });
      showToast(data.message, data.success ? 'success' : 'error');
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      const msg = (e?.code === 'functions/internal' || e?.message === 'INTERNAL' || e?.code === 'functions/not-found')
        ? 'Connection test function is not deployed to Firebase yet. Please run "npx firebase-tools deploy --only functions".'
        : (e?.message ?? 'UniFi connection test failed.');
      showToast(msg, 'error');
    } finally {
      setTestingUnifi(false);
    }
  };

  useEffect(() => {
    // Check URL parameters for PCO OAuth redirect status
    const params = new URLSearchParams(window.location.search);
    const pcoStatus = params.get('pco');
    if (pcoStatus === 'connected') {
      showToast('Successfully connected to Planning Center!', 'success');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (pcoStatus === 'error') {
      const reason = params.get('reason');
      showToast(`Planning Center connection failed${reason ? `: ${reason}` : ''}.`, 'error');
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (!orgId) {
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    getOrgSettings(orgId)
      .then((s) => {
        if (!isMounted) return;
        setSettings(s);
        if (s) {
          setUnlockBuffer(s.unlock_buffer_before_min);
          setLockBuffer(s.lock_buffer_after_min);
          setPollInterval(s.poll_interval_min);
          setTimezone(s.timezone ?? 'America/Chicago');
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [orgId, showToast]);

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

  const [unifiMode, setUnifiMode] = useState<'agent' | 'remote'>('agent');
  const [remoteHost, setRemoteHost] = useState('');
  const [remoteToken, setRemoteToken] = useState('');
  const [wizardStep, setWizardStep] = useState(1);
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    if (settings) {
      if (settings.unifi_mode) setUnifiMode(settings.unifi_mode);
      if (settings.unifi_remote) {
        setRemoteHost(settings.unifi_remote.host ?? '');
        setRemoteToken(settings.unifi_remote.access_token ?? '');
      }
    }
  }, [settings]);

  const handleSaveUnifiMode = async (mode: 'agent' | 'remote') => {
    if (!orgId) return;
    setSaving(true);
    try {
      await updateOrgSettings(orgId, {
        unifi_mode: mode,
        ...(mode === 'remote' ? { unifi_remote: { host: remoteHost.trim(), access_token: remoteToken.trim() } } : {}),
      });
      setUnifiMode(mode);
      showToast(`UniFi connection mode updated to ${mode === 'agent' ? 'Local Agent' : 'Remote Direct'}.`, 'success');
    } catch {
      showToast('Failed to update UniFi connection mode.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const isPcoConnected = !!settings?.pco_oauth?.access_token;
  const isUnifiConfigured = unifiMode === 'remote' ? (!!remoteHost && !!remoteToken) : true;

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
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Settings</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Manage Planning Center integration, UniFi controller connection, and timing rules.
          </p>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setShowWizard(!showWizard)}
        >
          {showWizard ? 'Hide Setup Wizard' : '⚡ Launch Setup Wizard'}
        </button>
      </div>

      {/* ─── Setup Wizard Stepper Banner ─── */}
      {showWizard && (
        <div className="card" style={{ marginBottom: '1.5rem', background: 'var(--color-bg-surface)', border: '1px solid var(--color-accent-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Tenant Setup Wizard — Step {wizardStep} of 4
            </h2>
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
              {isPcoConnected ? '✓ PCO Authorized' : '⚠️ PCO Action Required'}
            </div>
          </div>

          {/* Stepper Progress Bar */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
            {[
              { num: 1, label: '1. PCO Authorization' },
              { num: 2, label: '2. UniFi Connection' },
              { num: 3, label: '3. Timings & Timezone' },
              { num: 4, label: '4. Door Mappings' },
            ].map((step) => (
              <button
                key={step.num}
                onClick={() => setWizardStep(step.num)}
                style={{
                  flex: 1,
                  padding: '0.625rem 0.75rem',
                  borderRadius: 'var(--radius-md)',
                  border: wizardStep === step.num ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                  background: wizardStep === step.num ? 'var(--color-bg-base)' : 'transparent',
                  color: wizardStep === step.num ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                  fontWeight: wizardStep === step.num ? 600 : 400,
                  fontSize: '0.8125rem',
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                {step.label}
              </button>
            ))}
          </div>

          {/* Wizard Step Content */}
          <div style={{ padding: '1rem', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
            {wizardStep === 1 && (
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Step 1: Connect Planning Center Online</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
                  Authorize the application to sync your church&apos;s Planning Center Services and Groups schedules.
                </p>
                {isPcoConnected ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-success)', fontWeight: 600 }}>
                    <CheckCircleIcon /> Planning Center is authorized and connected!
                  </div>
                ) : (
                  <a href={`/api/pco/auth?orgId=${orgId}`} className="btn btn-primary btn-sm">
                    Authenticate with Planning Center
                  </a>
                )}
              </div>
            )}

            {wizardStep === 2 && (
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Step 2: Select UniFi Connection Mode</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
                  Choose whether your UniFi controller is accessed via an on-premises Local Agent or over direct HTTPS Cloud connection.
                </p>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button
                    className={`btn btn-sm ${unifiMode === 'agent' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => handleSaveUnifiMode('agent')}
                  >
                    On-Premises Local Agent
                  </button>
                  <button
                    className={`btn btn-sm ${unifiMode === 'remote' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => handleSaveUnifiMode('remote')}
                  >
                    Direct Remote HTTPS
                  </button>
                </div>
              </div>
            )}

            {wizardStep === 3 && (
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Step 3: Set Event Buffer Timings</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
                  Define how many minutes before event start doors unlock, and how long after event end they lock.
                </p>
                <button className="btn btn-primary btn-sm" onClick={handleSaveTimings} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Timing Rules'}
                </button>
              </div>
            )}

            {wizardStep === 4 && (
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Step 4: Map Schedules to Doors</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
                  Link your Planning Center Service Types / Groups to specific UniFi doors to automate unlocking schedules.
                </p>
                <a href="/mappings" className="btn btn-primary btn-sm">
                  Go to Door Mappings ➔
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* ── 1. Planning Center Connection ── */}
        <SectionCard title="1. Planning Center Connection">
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

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {isPcoConnected ? (
              <>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleTestPcoConnection}
                  disabled={testingPco}
                >
                  {testingPco ? 'Testing PCO…' : '⚡ Test Connection'}
                </button>
                <button className="btn btn-danger btn-sm" onClick={handleDisconnectPco}>
                  Disconnect
                </button>
              </>
            ) : (
              <a href={`/api/pco/auth?orgId=${orgId}`} className="btn btn-primary btn-sm">
                Connect Planning Center
              </a>
            )}
          </div>
        </SectionCard>

        {/* ── 2. UniFi Controller Connection Mode ── */}
        <SectionCard title="2. UniFi Controller Connection">
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9375rem', marginBottom: '1.25rem', lineHeight: 1.6 }}>
            Select how the application connects to your UniFi Access Controller.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            {/* Mode A: Local Agent */}
            <div
              onClick={() => handleSaveUnifiMode('agent')}
              style={{
                padding: '1.25rem',
                borderRadius: 'var(--radius-md)',
                border: unifiMode === 'agent' ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                background: unifiMode === 'agent' ? 'var(--color-bg-surface)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 600 }}>Option A: On-Premises Local Agent</h3>
                {unifiMode === 'agent' && <span className="badge badge-success">Active</span>}
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                Best for UniFi controllers behind local firewalls. Runs a lightweight Docker container inside your network.
              </p>
            </div>

            {/* Mode B: Direct Remote HTTPS */}
            <div
              onClick={() => handleSaveUnifiMode('remote')}
              style={{
                padding: '1.25rem',
                borderRadius: 'var(--radius-md)',
                border: unifiMode === 'remote' ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                background: unifiMode === 'remote' ? 'var(--color-bg-surface)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 600 }}>Option B: Direct Remote HTTPS</h3>
                {unifiMode === 'remote' && <span className="badge badge-success">Active</span>}
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                Best for internet-accessible UniFi controllers (Static IP or DDNS). Connects directly from Cloud Functions without an agent.
              </p>
            </div>
          </div>

          {/* Mode Details & Setup Form */}
          {unifiMode === 'remote' ? (
            <div style={{ background: 'var(--color-bg-base)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, marginBottom: '1rem' }}>Remote UniFi Console Configuration</h3>
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label">UniFi Host URL</label>
                <input
                  type="url"
                  className="form-input"
                  placeholder="https://unifi.mychurch.org:8443 or https://72.x.x.x:8443"
                  value={remoteHost}
                  onChange={(e) => setRemoteHost(e.target.value)}
                />
                <span className="form-hint">Public HTTPS URL of your UniFi OS Console or Access application.</span>
              </div>
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label">UniFi Developer API Bearer Token</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="API Token generated in UniFi Access -> Settings -> API"
                  value={remoteToken}
                  onChange={(e) => setRemoteToken(e.target.value)}
                />
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleSaveUnifiMode('remote')}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Remote Connection'}
              </button>
            </div>
          ) : (
            <div>
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label">Organization ID</label>
                <input
                  type="text"
                  className="form-input"
                  value={orgId ?? '—'}
                  readOnly
                  style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <label className="form-label" style={{ margin: 0 }}>Agent .env Snippet</label>
                  <button className="btn btn-secondary btn-sm" onClick={copyEnvSnippet}>
                    <CopyIcon />
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <pre style={{ margin: 0 }}>{`ORG_ID=${orgId ?? '<your-org-id>'}
FIREBASE_PROJECT_ID=${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'barnabasunfi'}
UNIFI_HOST=https://<your-local-unifi-ip>
UNIFI_ACCESS_TOKEN=<your-unifi-api-token>
SKIP_TLS_VERIFY=true`}</pre>
              </div>

              {/* Step-by-step Setup Instructions */}
              <div style={{ background: 'var(--color-bg-base)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', marginTop: '1rem' }}>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--color-text-primary)' }}>
                  📖 Step-by-Step Local Agent Setup Instructions:
                </h4>
                <ol style={{ paddingLeft: '1.25rem', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                  <li>Log in to your local UniFi OS Console (`https://192.168.1.1`).</li>
                  <li>Navigate to <strong>UniFi Access ➔ Settings ➔ System Settings ➔ API / Integrations</strong>.</li>
                  <li>Click <strong>Create API Token</strong> and grant door lock/unlock permissions.</li>
                  <li>Create a `.env` file on your local machine using the snippet above.</li>
                  <li>Run the agent via Docker:
                    <br />
                    <code style={{ background: 'var(--color-bg-surface)', padding: '0.25rem 0.5rem', borderRadius: '4px', display: 'inline-block', marginTop: '0.35rem' }}>
                      docker run -d --name unifi-pco-agent --env-file .env ghcr.io/matthewhon/unifi-pco-agent:latest
                    </code>
                  </li>
                </ol>
              </div>
            </div>
          )}

          <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)', display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleTestUnifiConnection}
              disabled={testingUnifi}
            >
              {testingUnifi ? 'Testing UniFi Connection…' : '⚡ Test UniFi Connection'}
            </button>
          </div>
        </SectionCard>

        {/* ── 3. Timing Configuration ── */}
        <SectionCard title="3. Timing Configuration">
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
                {saving ? 'Saving…' : 'Save Timing Settings'}
              </button>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
