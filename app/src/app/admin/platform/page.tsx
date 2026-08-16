'use client';

import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';

interface PlatformConfigDisplay {
  exists: boolean;
  pco_client_id?: string;
  pco_client_secret_preview?: string;
  redirect_uri?: string;
  updated_at?: string;
  updated_by?: string;
}

export default function AdminPlatformPage() {
  const { role, loading } = useAuth();
  const router = useRouter();

  const [config, setConfig] = useState<PlatformConfigDisplay | null>(null);
  const [fetching, setFetching] = useState(true);

  // Form state
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState(
    'https://us-central1-barnabasunfi.cloudfunctions.net/pcoOAuthCallback',
  );
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Guard: super_admin only
  useEffect(() => {
    if (!loading && role !== 'super_admin') {
      router.replace('/');
    }
  }, [role, loading, router]);

  // Load current config on mount
  useEffect(() => {
    if (role !== 'super_admin') return;
    const fn = httpsCallable<unknown, PlatformConfigDisplay>(functions, 'getPlatformConfigCallable');
    fn({})
      .then(({ data }) => {
        setConfig(data);
        if (data.pco_client_id) setClientId(data.pco_client_id);
        if (data.redirect_uri) setRedirectUri(data.redirect_uri);
      })
      .catch(() => setConfig({ exists: false }))
      .finally(() => setFetching(false));
  }, [role]);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const fn = httpsCallable(functions, 'updatePlatformConfig');
      const payload: Record<string, string> = {
        pco_client_id: clientId.trim(),
        redirect_uri: redirectUri.trim(),
      };
      if (clientSecret.trim()) {
        payload.pco_client_secret = clientSecret.trim();
      }
      await fn(payload);
      showToast('Platform config saved successfully.', 'success');
      setClientSecret(''); // Clear secret field after save
      setShowSecret(false);
      // Refresh display
      const getfn = httpsCallable<unknown, PlatformConfigDisplay>(functions, 'getPlatformConfigCallable');
      const { data } = await getfn({});
      setConfig(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading || role !== 'super_admin') return null;

  return (
    <div>
      {toast && (
        <div style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 1000,
          background: toast.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)',
          color: '#fff', padding: '0.75rem 1.25rem', borderRadius: 'var(--radius-md)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)', fontWeight: 500,
        }}>
          {toast.msg}
        </div>
      )}

      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Super Admin badge */}
          <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>SUPER ADMIN</span>
          <h1 className="page-title" style={{ margin: 0 }}>Platform Configuration</h1>
        </div>
        <p style={{ color: 'var(--color-text-secondary)', marginTop: '0.4rem' }}>
          Manage platform-wide credentials and integrations. These settings apply to all organizations.
        </p>
      </div>

      <div style={{ maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* ── PCO OAuth App Credentials ── */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
              Planning Center OAuth App
            </h2>
            {config?.exists && (
              <span className="badge badge-success">Configured</span>
            )}
            {config && !config.exists && (
              <span className="badge badge-danger">Not Set</span>
            )}
          </div>

          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
            These credentials come from your OAuth application at{' '}
            <a href="https://api.planningcenteronline.com/oauth/applications" target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--color-accent)' }}>
              api.planningcenteronline.com/oauth/applications
            </a>. They are shared across all organizations.
          </p>

          {fetching ? (
            <div style={{ color: 'var(--color-text-muted)', padding: '1rem 0' }}>Loading current config…</div>
          ) : (
            <>
              {/* Current values display */}
              {config?.exists && (
                <div style={{
                  background: 'var(--color-bg-base)', borderRadius: 'var(--radius-md)',
                  padding: '0.875rem 1rem', marginBottom: '1.25rem', fontSize: '0.8rem',
                  border: '1px solid var(--color-border)',
                }}>
                  <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.5rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '0.7rem' }}>
                    Current Values
                  </div>
                  <div style={{ display: 'grid', gap: '0.4rem' }}>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                      <span style={{ color: 'var(--color-text-muted)', minWidth: 110 }}>Client ID</span>
                      <code style={{ color: 'var(--color-text-secondary)', wordBreak: 'break-all' }}>{config.pco_client_id}</code>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                      <span style={{ color: 'var(--color-text-muted)', minWidth: 110 }}>Client Secret</span>
                      <code style={{ color: 'var(--color-text-secondary)' }}>{config.pco_client_secret_preview}</code>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                      <span style={{ color: 'var(--color-text-muted)', minWidth: 110 }}>Redirect URI</span>
                      <code style={{ color: 'var(--color-text-secondary)', wordBreak: 'break-all', fontSize: '0.75rem' }}>{config.redirect_uri}</code>
                    </div>
                    {config.updated_at && (
                      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
                        <span style={{ color: 'var(--color-text-muted)', minWidth: 110 }}>Last Updated</span>
                        <span style={{ color: 'var(--color-text-muted)' }}>{new Date(config.updated_at).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Edit form */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="pco-client-id">Client ID</label>
                  <input
                    id="pco-client-id"
                    className="form-input"
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="e.g. e96a9abe393119e8..."
                    spellCheck={false}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="pco-client-secret">
                    Client Secret
                    <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: '0.5rem', fontSize: '0.8rem' }}>
                      {config?.exists ? '(leave blank to keep existing)' : ''}
                    </span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="pco-client-secret"
                      className="form-input"
                      type={showSecret ? 'text' : 'password'}
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder={config?.exists ? '••••••••••••••••••••••••' : 'pco_app_...'}
                      spellCheck={false}
                      style={{ paddingRight: '2.75rem' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((v) => !v)}
                      style={{
                        position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0,
                      }}
                      title={showSecret ? 'Hide' : 'Show'}
                    >
                      {showSecret ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="redirect-uri">OAuth Redirect URI</label>
                  <input
                    id="redirect-uri"
                    className="form-input"
                    type="url"
                    value={redirectUri}
                    onChange={(e) => setRedirectUri(e.target.value)}
                    spellCheck={false}
                  />
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', marginTop: '0.35rem' }}>
                    This must exactly match what&apos;s configured in your PCO OAuth app.
                  </p>
                </div>

                <div>
                  <button className="btn btn-primary" onClick={handleSave} disabled={saving || !clientId.trim()}>
                    {saving ? 'Saving…' : config?.exists ? 'Update Credentials' : 'Save Credentials'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Info Card ── */}
        <div style={{
          border: '1px solid rgba(36, 101, 245, 0.3)',
          borderRadius: 'var(--radius-md)',
          padding: '1rem 1.25rem',
          background: 'rgba(36, 101, 245, 0.05)',
          fontSize: '0.875rem',
          color: 'var(--color-text-secondary)',
        }}>
          <div style={{ fontWeight: 600, color: 'var(--color-accent)', marginBottom: '0.5rem' }}>
            🔐 Security Note
          </div>
          The Client Secret is stored encrypted in Firestore under{' '}
          <code style={{ background: 'var(--color-bg-elevated)', padding: '2px 6px', borderRadius: 4, fontSize: '0.8rem' }}>
            platform_config/pco
          </code>{' '}
          and is only accessible to Cloud Functions (via Admin SDK) and super_admin users.
          It is never exposed to regular org members or browser clients.
          The secret is partially masked when displayed.
        </div>
      </div>
    </div>
  );
}
