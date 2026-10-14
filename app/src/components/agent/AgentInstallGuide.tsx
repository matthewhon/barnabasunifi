'use client';

import React, { useState } from 'react';

interface AgentInstallGuideProps {
  connectionToken?: string;
  showDownloadButton?: boolean;
}

export default function AgentInstallGuide({
  connectionToken = '',
  showDownloadButton = true,
}: AgentInstallGuideProps) {
  const [activeTab, setActiveTab] = useState<'windows' | 'mac' | 'cli'>('windows');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  }

  const tokenPlaceholder = connectionToken || '<YOUR_CONNECTION_TOKEN>';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Download Header Box if enabled */}
      {showDownloadButton && (
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(36, 101, 245, 0.08) 0%, rgba(16, 185, 129, 0.05) 100%)',
            padding: '1.25rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid rgba(36, 101, 245, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <span style={{ fontSize: '1.25rem' }}>📦</span>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
                UnFi-PCO Local Agent Package
              </h3>
              <span className="badge badge-primary" style={{ fontSize: '0.6875rem' }}>v1.2.9</span>
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: 0 }}>
              Pre-configured package with Docker files, automatic LAN scanner, and one-click launch scripts.
            </p>
          </div>
          <a
            href="/api/agent/download"
            download="unifi-pco-agent.zip"
            className="btn btn-primary"
            style={{
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontWeight: 600,
              padding: '0.6rem 1.25rem',
              boxShadow: '0 2px 8px rgba(36, 101, 245, 0.3)',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>Download Agent (.zip)</span>
          </a>
        </div>
      )}

      {/* Prerequisites Checklist */}
      <div
        style={{
          background: 'var(--color-bg-base)',
          padding: '1rem 1.25rem',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span>📋</span> Prerequisites Checklist
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '0.75rem', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
            <span style={{ color: 'var(--color-success)' }}>✓</span>
            <div>
              <strong>Docker Installed:</strong> Ensure <a href="https://docs.docker.com/get-docker/" target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)' }}>Docker Desktop</a> (Windows/macOS) or Docker Engine (Linux) is running.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
            <span style={{ color: 'var(--color-success)' }}>✓</span>
            <div>
              <strong>Same Local Network:</strong> Computer must be on the church's local Wi-Fi or Ethernet LAN as your UniFi Console.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
            <span style={{ color: 'var(--color-success)' }}>✓</span>
            <div>
              <strong>Connection Token:</strong> Generated above in Settings to link your church organization.
            </div>
          </div>
        </div>
      </div>

      {/* Platform Tabs Header */}
      <div>
        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'windows' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('windows')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}
          >
            <span>🪟 Windows Setup</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'mac' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('mac')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}
          >
            <span>🍎 macOS &amp; 🐧 Linux</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'cli' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('cli')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}
          >
            <span>⚡ Zero-Touch CLI</span>
          </button>
        </div>

        {/* Tab 1: Windows */}
        {activeTab === 'windows' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.875rem' }}>
              <div style={{ width: '1.75rem', height: '1.75rem', borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8125rem', flexShrink: 0 }}>
                1
              </div>
              <div style={{ flex: 1 }}>
                <strong style={{ color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>Download and Extract the Package</strong>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  Download <code>unifi-pco-agent.zip</code>. Right-click the downloaded zip file, select <strong>Extract All...</strong>, and choose a permanent destination folder (e.g. <code>C:\unifi-pco-agent</code>).
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.875rem' }}>
              <div style={{ width: '1.75rem', height: '1.75rem', borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8125rem', flexShrink: 0 }}>
                2
              </div>
              <div style={{ flex: 1 }}>
                <strong style={{ color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>Double-Click START_AGENT.bat</strong>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  In the extracted folder, double-click <strong><code>START_AGENT.bat</code></strong>. This will automatically verify prerequisites, build the Docker container, and start streaming live logs.
                </p>
                <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  💡 <em>Note: Make sure Docker Desktop is open and running in your Windows taskbar before launching.</em>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.875rem' }}>
              <div style={{ width: '1.75rem', height: '1.75rem', borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8125rem', flexShrink: 0 }}>
                3
              </div>
              <div style={{ flex: 1 }}>
                <strong style={{ color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>Open Web Setup Portal &amp; Pair</strong>
                <p style={{ margin: '0.25rem 0 0.5rem 0', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  Open your browser and navigate to <a href="http://localhost:8080" target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)', fontWeight: 600 }}><code>http://localhost:8080</code></a>.
                </p>
                <div style={{ padding: '0.75rem', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <div>• Paste your <strong>Connection Token</strong> copied from the Settings page.</div>
                  <div>• Click <strong>Scan Subnet</strong> to let the agent auto-detect your UniFi Console on the LAN.</div>
                  <div>• Click <strong>Connect &amp; Register</strong>. Your doors will sync automatically!</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: macOS / Linux */}
        {activeTab === 'mac' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.875rem' }}>
              <div style={{ width: '1.75rem', height: '1.75rem', borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8125rem', flexShrink: 0 }}>
                1
              </div>
              <div style={{ flex: 1 }}>
                <strong style={{ color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>Extract the Downloaded Zip</strong>
                <p style={{ margin: '0.25rem 0 0.5rem 0', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  Open Terminal, extract the zip file, and navigate into the folder:
                </p>
                <div style={{ position: 'relative' }}>
                  <pre style={{ margin: 0, padding: '0.625rem 0.75rem', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', overflowX: 'auto', border: '1px solid var(--color-border)' }}>
                    unzip unifi-pco-agent.zip -d unifi-pco-agent && cd unifi-pco-agent
                  </pre>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => copyToClipboard('unzip unifi-pco-agent.zip -d unifi-pco-agent && cd unifi-pco-agent', 'mac-unzip')}
                    style={{ position: 'absolute', right: '0.35rem', top: '0.35rem', fontSize: '0.6875rem', padding: '0.1rem 0.4rem' }}
                  >
                    {copiedCode === 'mac-unzip' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.875rem' }}>
              <div style={{ width: '1.75rem', height: '1.75rem', borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8125rem', flexShrink: 0 }}>
                2
              </div>
              <div style={{ flex: 1 }}>
                <strong style={{ color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>Run the Launcher Script</strong>
                <p style={{ margin: '0.25rem 0 0.5rem 0', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  Execute the bundled launcher script (or run <code>docker compose up -d</code>):
                </p>
                <div style={{ position: 'relative' }}>
                  <pre style={{ margin: 0, padding: '0.625rem 0.75rem', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', overflowX: 'auto', border: '1px solid var(--color-border)' }}>
                    chmod +x start_agent.sh && ./start_agent.sh
                  </pre>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => copyToClipboard('chmod +x start_agent.sh && ./start_agent.sh', 'mac-start')}
                    style={{ position: 'absolute', right: '0.35rem', top: '0.35rem', fontSize: '0.6875rem', padding: '0.1rem 0.4rem' }}
                  >
                    {copiedCode === 'mac-start' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.875rem' }}>
              <div style={{ width: '1.75rem', height: '1.75rem', borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8125rem', flexShrink: 0 }}>
                3
              </div>
              <div style={{ flex: 1 }}>
                <strong style={{ color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>Open Web Setup Portal &amp; Pair</strong>
                <p style={{ margin: '0.25rem 0 0.5rem 0', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  Open <a href="http://localhost:8080" target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)', fontWeight: 600 }}><code>http://localhost:8080</code></a>, paste your Connection Token, and click <strong>Connect &amp; Register</strong>.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Zero-Touch CLI */}
        {activeTab === 'cli' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.5 }}>
              For headless Linux servers or background environments, you can pass your connection token directly into the container. It will authenticate with the cloud, auto-scan the LAN, and begin syncing doors immediately without opening the web portal.
            </p>
            <div style={{ position: 'relative' }}>
              <pre style={{ margin: 0, padding: '0.75rem 1rem', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', overflowX: 'auto', border: '1px solid var(--color-border)', lineHeight: 1.6 }}>
                {`docker run -d \\
  --name unifi-pco-agent \\
  --restart unless-stopped \\
  --network host \\
  -e CONNECTION_TOKEN=${tokenPlaceholder} \\
  unifi-pco-agent`}
              </pre>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => copyToClipboard(`docker run -d --name unifi-pco-agent --restart unless-stopped --network host -e CONNECTION_TOKEN=${tokenPlaceholder} unifi-pco-agent`, 'cli-run')}
                style={{ position: 'absolute', right: '0.5rem', top: '0.5rem', fontSize: '0.6875rem', padding: '0.2rem 0.5rem' }}
              >
                {copiedCode === 'cli-run' ? 'Copied!' : 'Copy Command'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Useful Management Commands Footer */}
      <div style={{ paddingTop: '1rem', borderTop: '1px solid var(--color-border)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))', gap: '0.75rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
        <div>
          <strong>View Live Logs:</strong><br />
          <code>docker compose logs -f</code>
        </div>
        <div>
          <strong>Restart Agent:</strong><br />
          <code>docker compose restart</code>
        </div>
        <div>
          <strong>Stop Agent:</strong><br />
          <code>docker compose down</code>
        </div>
      </div>
    </div>
  );
}
