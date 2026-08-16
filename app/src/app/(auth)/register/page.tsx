'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';

export default function RegisterPage() {
  const router = useRouter();
  const { user, registerWithEmail, refreshAuth, orgId } = useAuth();

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // If user is logged in and already has an org, redirect to home
  React.useEffect(() => {
    if (user && orgId) {
      router.push('/');
    }
  }, [user, orgId, router]);

  function getErrorMessage(err: unknown): string {
    if (err && typeof err === 'object') {
      const code = (err as { code?: string }).code ?? '';
      const message = (err as { message?: string }).message;

      switch (code) {
        case 'auth/email-already-in-use':
          return 'An account with this email already exists. Try signing in instead.';
        case 'auth/weak-password':
          return 'Password must be at least 6 characters.';
        case 'auth/invalid-email':
          return 'Please enter a valid email address.';
        case 'auth/network-request-failed':
          return 'Network error. Check your connection and try again.';
        case 'functions/internal':
        case 'internal':
          return message && message !== 'INTERNAL' ? message : 'Organization creation failed. Please make sure Firebase Cloud Functions are running or deployed.';
      }
      if (message && message !== 'INTERNAL') {
        return message;
      }
    }
    return 'An unexpected error occurred while setting up your organization. Please try again.';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const nameToUse = (displayName.trim() || user?.displayName || user?.email || 'Admin').trim();

    if (!user) {
      if (!displayName.trim()) {
        setError('Please enter your display name.');
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    if (!orgName.trim()) {
      setError('Please enter your organization name.');
      return;
    }

    setLoading(true);

    try {
      if (!user) {
        // Step 1: Create the Firebase Auth user and Firestore profile
        await registerWithEmail(email.trim(), password, displayName.trim());
      }

      // Step 2: Call Cloud Function to create the organization and set org_admin claim
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';
      const createOrganization = httpsCallable<
        { orgName: string; displayName: string; timezone: string },
        { orgId: string }
      >(functions, 'createOrganization');

      await createOrganization({
        orgName: orgName.trim(),
        displayName: nameToUse,
        timezone: userTimezone,
      });

      // Step 3: Refresh auth context to pick up new claims immediately
      await refreshAuth();

      // Step 4: Redirect to home
      router.push('/');
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ width: '100%', maxWidth: '28rem' }}>
      {/* Logo / App name */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginBottom: '2rem',
          gap: '0.75rem',
        }}
      >
        <div
          style={{
            width: '3rem',
            height: '3rem',
            borderRadius: '0.75rem',
            background: 'linear-gradient(135deg, #2465F5 0%, #1a4fd6 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(36, 101, 245, 0.4)',
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div style={{ textAlign: 'center' }}>
          <h1
            style={{
              fontSize: '1.375rem',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.02em',
            }}
          >
            Create your organization
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Set up Barnabas Access for your church
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: '1.75rem' }}>
        {error && (
          <div className="alert alert-danger" style={{ marginBottom: '1.25rem' }}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0, marginTop: '0.1rem' }}
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
        >
          <div className="form-group">
            <label htmlFor="displayName" className="form-label">
              Your Full Name
            </label>
            <input
              id="displayName"
              type="text"
              className="form-input"
              placeholder="Jane Smith"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="orgName" className="form-label">
              Organization Name
            </label>
            <input
              id="orgName"
              type="text"
              className="form-input"
              placeholder="First Baptist Church"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          {!user && (
            <>
              <div className="form-group">
                <label htmlFor="email" className="form-label">
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  className="form-input"
                  placeholder="you@church.org"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label htmlFor="password" className="form-label">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  className="form-input"
                  placeholder="Minimum 6 characters"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword" className="form-label">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  className="form-input"
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={loading}
                />
                {confirmPassword && password !== confirmPassword && (
                  <span className="form-error">Passwords do not match</span>
                )}
              </div>
            </>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '0.25rem' }}
            disabled={loading}
          >
            {loading ? (
              <>
                <span
                  style={{
                    width: '1rem',
                    height: '1rem',
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: '#fff',
                    borderRadius: '50%',
                    animation: 'spin 0.7s linear infinite',
                    display: 'inline-block',
                  }}
                />
                {user ? 'Setting up organization…' : 'Creating account…'}
              </>
            ) : user ? (
              'Set Up Organization'
            ) : (
              'Create Account'
            )}
          </button>
        </form>
      </div>

      <p
        style={{
          textAlign: 'center',
          marginTop: '1.25rem',
          fontSize: '0.875rem',
          color: 'var(--color-text-muted)',
        }}
      >
        Already have an account?{' '}
        <Link href="/login" style={{ fontWeight: 500 }}>
          Sign in
        </Link>
      </p>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
