'use client';

import React, { useState } from 'react';

interface UniFiCredentialsGuideProps {
  defaultExpanded?: boolean;
}

export default function UniFiCredentialsGuide({
  defaultExpanded = true,
}: UniFiCredentialsGuideProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div
      style={{
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        overflow: 'hidden',
        marginBottom: '1rem',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.875rem 1rem',
          background: 'var(--color-bg-base)',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: '0.875rem',
          fontWeight: 600,
          color: 'var(--color-text-primary)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>🔑</span>
          <span>How to Generate UniFi Access API Credentials (Step-by-Step)</span>
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          {expanded ? '▲ Hide Instructions' : '▼ Show Instructions'}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', borderTop: '1px solid var(--color-border)' }}>
          {/* Step 1 */}
          <div style={{ display: 'flex', gap: '0.875rem' }}>
            <div style={{ width: '1.75rem', height: '1.75rem', borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8125rem', flexShrink: 0 }}>
              1
            </div>
            <div style={{ flex: 1 }}>
              <strong style={{ color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>Log in to your UniFi OS Console</strong>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                Open a web browser and go to your UniFi Console local IP address (typically <a href="https://192.168.1.1" target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)' }}><code>https://192.168.1.1</code></a> or <code>https://unifi.local</code>) or via <a href="https://unifi.ui.com" target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)' }}>unifi.ui.com</a>. Log in with an <strong>Admin</strong> or <strong>Owner</strong> account.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div style={{ display: 'flex', gap: '0.875rem' }}>
            <div style={{ width: '1.75rem', height: '1.75rem', borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8125rem', flexShrink: 0 }}>
              2
            </div>
            <div style={{ flex: 1 }}>
              <strong style={{ color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>Open the UniFi Access Application</strong>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                From the UniFi OS application dashboard, click on <strong>Access</strong> (the door icon).
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div style={{ display: 'flex', gap: '0.875rem' }}>
            <div style={{ width: '1.75rem', height: '1.75rem', borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8125rem', flexShrink: 0 }}>
              3
            </div>
            <div style={{ flex: 1 }}>
              <strong style={{ color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>Navigate to Settings → General</strong>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                In the bottom-left sidebar of the UniFi Access application, click the <strong>Settings (⚙️ gear icon)</strong>, then select the <strong>General</strong> tab (or <strong>System</strong> in some versions).
              </p>
            </div>
          </div>

          {/* Step 4 */}
          <div style={{ display: 'flex', gap: '0.875rem' }}>
            <div style={{ width: '1.75rem', height: '1.75rem', borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8125rem', flexShrink: 0 }}>
              4
            </div>
            <div style={{ flex: 1 }}>
              <strong style={{ color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>Enable Developer API &amp; Copy the API Token</strong>
              <p style={{ margin: '0.25rem 0 0.5rem 0', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                Scroll down to the <strong>Developer API</strong> section:
              </p>
              <div style={{ padding: '0.75rem', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div>1. Toggle <strong>Enable Developer API</strong> to <strong>ON</strong>.</div>
                <div>2. Under <strong>API Token</strong>, click <strong>Generate</strong> (or copy your existing token).</div>
                <div>3. Paste the token into the <strong>UniFi Access API Token</strong> field below.</div>
              </div>
              <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span>⚠️</span> <em>Keep this token secure — it authorizes door unlock/lock schedules and status monitoring.</em>
              </div>
            </div>
          </div>

          {/* Step 5 */}
          <div style={{ display: 'flex', gap: '0.875rem' }}>
            <div style={{ width: '1.75rem', height: '1.75rem', borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8125rem', flexShrink: 0 }}>
              5
            </div>
            <div style={{ flex: 1 }}>
              <strong style={{ color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>(Optional) Developer API Key</strong>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                In the same Developer API section, locate <strong>API Key</strong>. Click <strong>Generate Key</strong> and paste it into the <strong>UniFi Developer API Key</strong> field. This enables detailed door badge activity logs and visitor sync.
              </p>
            </div>
          </div>

          {/* Step 6 */}
          <div style={{ display: 'flex', gap: '0.875rem' }}>
            <div style={{ width: '1.75rem', height: '1.75rem', borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8125rem', flexShrink: 0 }}>
              6
            </div>
            <div style={{ flex: 1 }}>
              <strong style={{ color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>Console Host IP &amp; TLS Validation</strong>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                Enter your UniFi Console's LAN IP (e.g. <code>https://192.168.1.1</code>), or <strong>leave blank</strong> to let the Docker agent automatically scan your local subnet. Make sure <strong>Skip TLS Certificate Validation</strong> is checked, as local consoles use self-signed certificates.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
