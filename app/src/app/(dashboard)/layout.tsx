'use client';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { getOrganization } from '@/lib/firestore';
import type { Organization } from '@/lib/types';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
}

function HouseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function DoorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
      <line x1="6" y1="1" x2="6" y2="4" />
      <line x1="10" y1="1" x2="10" y2="4" />
      <line x1="14" y1="1" x2="14" y2="4" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

function ServerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function VisitorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 11l-3 3-1.5-1.5" />
    </svg>
  );
}


function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function NavLink({ item, pathname, onClick }: { item: NavItem; pathname: string; onClick?: () => void }) {
  const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));

  return (
    <Link
      href={item.href}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
        padding: '0.5rem 0.75rem',
        borderRadius: 'var(--radius-md)',
        fontSize: '0.875rem',
        fontWeight: isActive ? 600 : 400,
        color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
        background: isActive ? 'rgba(36, 101, 245, 0.1)' : 'transparent',
        textDecoration: 'none',
        transition: 'all var(--transition-fast)',
        border: `1px solid ${isActive ? 'rgba(36,101,245,0.25)' : 'transparent'}`,
      }}
    >
      <span style={{ opacity: isActive ? 1 : 0.7 }}>{item.icon}</span>
      {item.label}
    </Link>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, orgId, role, isSuperAdmin, signOut, profile, refreshAuth } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [org, setOrg] = useState<Organization | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [provisionTimedOut, setProvisionTimedOut] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const awaitingOrg = !loading && !!user && !orgId && !isSuperAdmin;

  // Auth guard
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [loading, user, router]);

  // Bound the "provisioning" wait — otherwise a failed createOrganization call
  // leaves the user on a spinner that never resolves.
  useEffect(() => {
    if (!awaitingOrg) {
      setProvisionTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setProvisionTimedOut(true), 10000);
    return () => clearTimeout(timer);
  }, [awaitingOrg]);

  // Load org details
  useEffect(() => {
    if (orgId) {
      getOrganization(orgId).then((o) => setOrg(o));
    }
  }, [orgId]);

  // Close sidebar on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (sidebarOpen && sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setSidebarOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [sidebarOpen]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      router.push('/login');
    } finally {
      setSigningOut(false);
    }
  }

  const navItems: NavItem[] = [
    { href: '/', label: 'Dashboard', icon: <HouseIcon /> },
    { href: '/doors', label: 'Doors', icon: <DoorIcon /> },
    { href: '/visitors', label: 'Visitors', icon: <VisitorIcon /> },
    { href: '/schedule', label: 'Schedule', icon: <CalendarIcon /> },
    { href: '/mappings', label: 'Mappings', icon: <LinkIcon /> },
    { href: '/audit', label: 'Audit Log', icon: <ListIcon /> },
    { href: '/settings', label: 'Settings', icon: <GearIcon /> },
    { href: '/users', label: 'Users', icon: <UsersIcon />, adminOnly: true },
  ];

  const superAdminItems: NavItem[] = [
    { href: '/admin/platform', label: 'Platform Config', icon: <KeyIcon />, superAdminOnly: true },
  ];


  const visibleNavItems = navItems.filter((item) => {
    if (item.superAdminOnly) return isSuperAdmin;
    if (item.adminOnly) return role === 'org_admin' || isSuperAdmin;
    return true;
  });

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg-base)',
        }}
      >
        <div
          style={{
            width: '2.5rem',
            height: '2.5rem',
            border: '3px solid var(--color-border)',
            borderTopColor: 'var(--color-accent)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) return null;

  if (awaitingOrg) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg-base)',
          flexDirection: 'column',
          gap: '1rem',
          padding: '1.5rem',
        }}
      >
        {provisionTimedOut ? (
          <div
            style={{
              width: '3rem',
              height: '3rem',
              borderRadius: '50%',
              background: 'rgba(220, 38, 38, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-danger, #dc2626)',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
        ) : (
          <div
            style={{
              width: '3rem',
              height: '3rem',
              border: '3px solid var(--color-border)',
              borderTopColor: 'var(--color-accent)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
        )}
        <div style={{ textAlign: 'center', maxWidth: '24rem' }}>
          <h2 style={{ color: 'var(--color-text-primary)', marginBottom: '0.5rem' }}>
            {provisionTimedOut ? 'No organization found' : 'Organization setup in progress…'}
          </h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            {provisionTimedOut
              ? 'Your account is signed in but is not linked to an organization. If you just registered, setup did not finish — create your organization to continue, or refresh in case the change is still propagating.'
              : 'Your organization is being provisioned. If you just registered, this should complete automatically.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
          <button
            className="btn btn-secondary btn-sm"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              try {
                await refreshAuth();
              } finally {
                setRefreshing(false);
              }
            }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh Status'}
          </button>
          <Link href="/register" className="btn btn-primary btn-sm">
            Create Organization
          </Link>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleSignOut}
          style={{ marginTop: '0.5rem', color: 'var(--color-text-muted)' }}
        >
          Sign out
        </button>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const userInitial = (profile?.display_name ?? user.email ?? 'U')[0].toUpperCase();

  const sidebarContent = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Logo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          padding: '1.25rem 1rem',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div
          style={{
            width: '2rem',
            height: '2rem',
            borderRadius: '0.5rem',
            background: 'linear-gradient(135deg, #2465F5 0%, #1a4fd6 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.2 }}>
            Barnabas Access
          </div>
          {org && (
            <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', marginTop: '0.1rem' }}>
              {org.name}
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav
        style={{
          flex: 1,
          padding: '0.75rem 0.625rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.125rem',
          overflowY: 'auto',
        }}
      >
        {visibleNavItems.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            pathname={pathname}
            onClick={() => setSidebarOpen(false)}
          />
        ))}

        {isSuperAdmin && (
          <>
            <div
              style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--color-text-muted)',
                padding: '0.75rem 0.75rem 0.25rem',
                marginTop: '0.5rem',
              }}
            >
              Super Admin
            </div>
            {superAdminItems.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                pathname={pathname}
                onClick={() => setSidebarOpen(false)}
              />
            ))}
          </>
        )}
      </nav>

      {/* User profile footer */}
      <div
        style={{
          borderTop: '1px solid var(--color-border)',
          padding: '0.875rem 1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.625rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.625rem',
          }}
        >
        <div
          style={{
            width: '2rem',
            height: '2rem',
            borderRadius: '50%',
            background: 'var(--color-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.8125rem',
            fontWeight: 700,
            color: '#fff',
            flexShrink: 0,
          }}
        >
          {userInitial}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {profile?.display_name ?? user.email}
          </div>
          <div
            style={{
              fontSize: '0.6875rem',
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {role ?? 'viewer'}
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleSignOut}
          disabled={signingOut}
          title="Sign out"
          style={{ padding: '0.375rem', flexShrink: 0 }}
        >
          <LogOutIcon />
        </button>
        </div>
        {/* Version badge */}
        <div
          style={{
            fontSize: '0.625rem',
            color: 'var(--color-text-muted)',
            textAlign: 'center',
            opacity: 0.7,
            letterSpacing: '0.02em',
          }}
        >
          Dashboard v{process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0'}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--color-bg-base)' }}>
      {/* Desktop sidebar */}
      <aside
        style={{
          width: '14.5rem',
          flexShrink: 0,
          background: 'var(--color-bg-surface)',
          borderRight: '1px solid var(--color-border)',
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflowY: 'auto',
        }}
        className="sidebar-desktop"
      >
        {sidebarContent}
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
          }}
        >
          {/* Backdrop */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(2px)',
            }}
            onClick={() => setSidebarOpen(false)}
          />
          {/* Sidebar */}
          <div
            ref={sidebarRef}
            style={{
              position: 'relative',
              width: '15rem',
              background: 'var(--color-bg-surface)',
              borderRight: '1px solid var(--color-border)',
              height: '100%',
              zIndex: 51,
              animation: 'slideIn 0.2s ease',
            }}
          >
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Main content area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top bar (mobile) */}
        <header
          style={{
            height: '3.5rem',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-bg-surface)',
            display: 'flex',
            alignItems: 'center',
            paddingInline: '1rem',
            gap: '0.75rem',
            position: 'sticky',
            top: 0,
            zIndex: 40,
          }}
          className="topbar"
        >
          {/* Hamburger (mobile only) */}
          <button
            className="btn btn-ghost btn-sm sidebar-toggle"
            onClick={() => setSidebarOpen(true)}
            style={{ padding: '0.375rem' }}
            aria-label="Open menu"
          >
            <MenuIcon />
          </button>

          {/* Org name */}
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {org?.name ?? 'Loading…'}
            </span>
          </div>

          {/* User + sign out (top bar, visible on mobile) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div
              style={{
                width: '1.875rem',
                height: '1.875rem',
                borderRadius: '50%',
                background: 'var(--color-accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                fontWeight: 700,
                color: '#fff',
              }}
            >
              {userInitial}
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleSignOut}
              disabled={signingOut}
              title="Sign out"
              style={{ padding: '0.375rem' }}
            >
              <LogOutIcon />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, padding: '1.5rem', overflowY: 'auto' }}>
          {children}
        </main>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }

        @media (min-width: 768px) {
          .sidebar-toggle { display: none !important; }
          .sidebar-desktop { display: block !important; }
        }

        @media (max-width: 767px) {
          .sidebar-desktop { display: none !important; }
        }
      `}</style>
    </div>
  );
}
