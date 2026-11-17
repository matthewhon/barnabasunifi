'use client';

import React, { useState } from 'react';
import Modal from '@/components/ui/Modal';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

interface SendRequestLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
}

export default function SendRequestLinkModal({
  isOpen,
  onClose,
  orgId,
}: SendRequestLinkModalProps) {
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [inviteNote, setInviteNote] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [sendEmail, setSendEmail] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);

  const resetAndClose = () => {
    setRecipientName('');
    setRecipientEmail('');
    setInviteNote('');
    setExpiresInDays(7);
    setSendEmail(true);
    setError(null);
    setGeneratedUrl(null);
    setEmailSent(false);
    setCopied(false);
    onClose();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (sendEmail && (!recipientEmail.trim() || !recipientEmail.includes('@'))) {
      setError('Please enter a valid recipient email, or uncheck "Email form link directly".');
      return;
    }

    setLoading(true);
    try {
      const fn = httpsCallable<
        any,
        { success: boolean; requestId: string; requestUrl: string; emailSent: boolean }
      >(functions, 'createVisitorRequestLink');
      const res = await fn({
        orgId,
        recipientName: recipientName.trim() || undefined,
        recipientEmail: recipientEmail.trim() || undefined,
        inviteNote: inviteNote.trim() || undefined,
        expiresInDays,
        sendEmail,
      });
      setGeneratedUrl(res.data.requestUrl);
      setEmailSent(res.data.emailSent);
    } catch (err: any) {
      setError(err?.message || 'Failed to create visitor request link.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedUrl) return;
    await navigator.clipboard.writeText(generatedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal isOpen={isOpen} onClose={resetAndClose} title="Send Visitor Request Form">
      {generatedUrl ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div
            style={{
              padding: '0.875rem 1rem',
              borderRadius: '8px',
              background: 'var(--color-bg-secondary, #f1f5f9)',
              fontSize: '0.875rem',
            }}
          >
            {emailSent
              ? `Invite email sent to ${recipientEmail}. You can also copy the form link below.`
              : 'Visitor request form link created. Share this link with the person filling out the visitor details:'}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="text"
              readOnly
              className="form-input"
              value={generatedUrl}
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button type="button" className="btn-primary" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-secondary" onClick={resetAndClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
            Generate a one-time form link to send to someone so they can submit visitor details for
            your approval.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="form-label">Recipient Name</label>
              <input
                type="text"
                className="form-input"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="form-label">Recipient Email</label>
              <input
                type="email"
                className="form-input"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="host@example.com"
              />
            </div>
          </div>

          <div>
            <label className="form-label">Note for Recipient (optional)</label>
            <textarea
              className="form-input"
              rows={2}
              value={inviteNote}
              onChange={(e) => setInviteNote(e.target.value)}
              placeholder="e.g., Please fill this out for Sunday's guest speaker."
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
              />
              <span>Email form link directly</span>
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label className="form-label" style={{ margin: 0 }}>Expires in</label>
              <select
                className="form-input"
                style={{ width: 'auto' }}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(Number(e.target.value))}
              >
                <option value={1}>1 day</option>
                <option value={3}>3 days</option>
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
              </select>
            </div>
          </div>

          {error && (
            <div style={{ color: 'var(--color-danger, #ef4444)', fontSize: '0.875rem' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.625rem', marginTop: '0.5rem' }}>
            <button type="button" className="btn-secondary" onClick={resetAndClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creating...' : sendEmail ? 'Send Form Link' : 'Generate Link'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
