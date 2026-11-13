'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { getOrganization } from '@/lib/firestore';
import type { Organization } from '@/lib/types';
import { CalendarClock, DoorOpen, LogOut, Monitor, Users } from 'lucide-react';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const TABS = [
  { href: '/m', label: 'Doors', icon: DoorOpen, exact: true },
  { href: '/m/visitors', label: 'Visitors', icon: Users, exact: false },
  { href: '/m/schedules', label: 'Schedules', icon: CalendarClock, exact: false },
] as const;

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, orgId, role, loading, signOut } = useAuth();
  const [org, setOrg] = useState<Organization | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      const target = pathname && pathname.startsWith('/m') ? pathname : '/m';
      router.replace(`/login?redirect=${encodeURIComponent(target)}`);
    }
  }, [loading, user, pathname, router]);

  useEffect(() => {
    if (!orgId) {
      setOrg(null);
      return;
    }
    let cancelled = false;
    getOrganization(orgId)
      .then((data) => {
        if (!cancelled) setOrg(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.replace('/login?redirect=/m');
    } finally {
      setSigningOut(false);
    }
  };

  if (loading) {
    return (
      <div
        className="mobile-shell"
        style={{ alignItems: 'center', justifyContent: 'center', padding: '2rem' }}
      >
        <LoadingSpinner />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="mobile-shell">
      {/* Sticky Top Header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          background: 'rgba(26, 31, 46, 0.92)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--color-border)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        <div
          style={{
            maxWidth: '34rem',
            margin: '0 auto',
            height: '3.5rem',
            padding: '0 1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', minWidth: 0 }}>
            <div
              style={{
                width: '2rem',
                height: '2rem',
                borderRadius: '0.625rem',
                background: 'linear-gradient(135deg, #2465f5 0%, #1d4ed8 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                color: '#fff',
              }}
            >
              <DoorOpen size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '0.9375rem',
                  fontWeight: 700,
                  color: 'var(--color-text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {org?.name ?? 'UniFi Access'}
              </div>
              {role && (
                <div
                  style={{
                    fontSize: '0.6875rem',
                    color: 'var(--color-text-secondary)',
                    textTransform: 'capitalize',
                    lineHeight: 1.1,
                  }}
                >
                  {role.replace('_', ' ')}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
            <Link
              href="/"
              title="Switch to full desktop dashboard"
              style={{
                minHeight: '2.25rem',
                padding: '0 0.625rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-elevated)',
                color: 'var(--color-text-secondary)',
                fontSize: '0.75rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.375rem',
                textDecoration: 'none',
              }}
            >
              <Monitor size={14} />
              <span>Desktop</span>
            </Link>

            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              aria-label="Sign out"
              style={{
                width: '2.25rem',
                height: '2.25rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-elevated)',
                color: 'var(--color-text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main
        style={{
          flex: 1,
          width: '100%',
          maxWidth: '34rem',
          margin: '0 auto',
          padding: '1rem 1rem calc(5.5rem + env(safe-area-inset-bottom, 0px))',
        }}
      >
        {!orgId ? (
          <div
            style={{
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-xl)',
              padding: '1.5rem',
              textAlign: 'center',
              marginTop: '2rem',
            }}
          >
            <h1 style={{ fontSize: '1.125rem', marginBottom: '0.5rem' }}>No Organization Assigned</h1>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '1.25rem' }}>
              Your account is not linked to an organization yet. Please open the desktop dashboard or contact an administrator.
            </p>
            <Link
              href="/"
              className="mobile-touch-btn"
              style={{
                background: 'var(--color-accent)',
                color: '#fff',
                textDecoration: 'none',
                width: '100%',
              }}
            >
              Open Desktop Dashboard
            </Link>
          </div>
        ) : (
          children
        )}
      </main>

      {/* Fixed Bottom Navigation */}
      <nav
        aria-label="Mobile Navigation"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 35,
          background: 'rgba(26, 31, 46, 0.95)',
          backdropFilter: 'blur(14px)',
          borderTop: '1px solid var(--color-border)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div
          style={{
            maxWidth: '34rem',
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            height: '4rem',
          }}
        >
          {TABS.map((tab) => {
            const isActive = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.25rem',
                  textDecoration: 'none',
                  color: isActive ? '#60a5fa' : 'var(--color-text-secondary)',
                  fontWeight: isActive ? 700 : 500,
                  fontSize: '0.75rem',
                  position: 'relative',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: 0,
                      width: '2.5rem',
                      height: '3px',
                      borderRadius: '0 0 9999px 9999px',
                      background: 'var(--color-accent)',
                    }}
                  />
                )}
                <Icon size={21} strokeWidth={isActive ? 2.4 : 1.9} />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
