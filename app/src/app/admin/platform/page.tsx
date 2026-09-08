'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import Modal from '@/components/ui/Modal';
import { safeFormatDistanceToNow } from '@/lib/date-utils';
import { DonutChart, type DonutSegment } from '@/components/analytics/DonutChart';
import { AreaChart, type AreaDataPoint } from '@/components/analytics/AreaChart';
import { BarChart, type BarDataPoint } from '@/components/analytics/BarChart';

interface PlatformConfigDisplay {
  exists: boolean;
  pco_client_id?: string;
  pco_client_secret_preview?: string;
  redirect_uri?: string;
  updated_at?: string;
  updated_by?: string;
}

interface TenantItem {
  id: string;
  name: string;
  slug: string;
  created_at: string | null;
  pco_connected: boolean;
  unifi_mode: 'agent' | 'remote' | 'unconfigured';
  member_count: number;
  door_count: number;
  mapping_count: number;
  schedule_window_count: number;
  pco_org_name?: string;
  timezone?: string;
  agent_status?: {
    has_token: boolean;
    auto_discovered_host?: string;
    last_sync?: string;
  };
}

interface UserItem {
  uid: string;
  display_name: string;
  email: string;
  creation_time: string | null;
  last_sign_in_time: string | null;
  memberships: Record<string, { role: string; joined_at?: string }>;
  is_super_admin: boolean;
}

interface PlatformMetrics {
  total_tenants: number;
  total_users: number;
  total_doors: number;
  total_mappings: number;
  total_schedule_windows: number;
  pco_connected_tenants: number;
  unifi_agent_tenants: number;
  unifi_remote_tenants: number;
  active_users_30d: number;
  roles_distribution: {
    super_admin: number;
    org_admin: number;
    manager: number;
    viewer: number;
  };
  signup_timeline: Array<{
    period: string;
    tenants: number;
    users: number;
  }>;
}

interface SystemAuditItem {
  id: string;
  org_id: string;
  action: string;
  actor_name: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SoftwareAdminPage() {
  const { role, isSuperAdmin, loading, user: currentUser, setImpersonatedOrgId } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'overview' | 'tenants' | 'users' | 'credentials' | 'fleet'>('overview');

  // Overview & Data State
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [recentLogs, setRecentLogs] = useState<SystemAuditItem[]>([]);
  const [fetchingOverview, setFetchingOverview] = useState(false);

  // Config Form State
  const [config, setConfig] = useState<PlatformConfigDisplay | null>(null);
  const [fetchingConfig, setFetchingConfig] = useState(true);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState(
    'https://us-central1-barnabasunfi.cloudfunctions.net/pcoOAuthCallback',
  );
  const [showSecret, setShowSecret] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // Search & Filter State
  const [tenantSearch, setTenantSearch] = useState('');
  const [tenantFilter, setTenantFilter] = useState<'all' | 'pco' | 'agent' | 'remote'>('all');
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'super_admin' | 'org_admin' | 'manager' | 'viewer'>('all');

  // Modals & Action State
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Delete Tenant Modal
  const [deleteTenantModalOpen, setDeleteTenantModalOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<TenantItem | null>(null);
  const [confirmTenantName, setConfirmTenantName] = useState('');
  const [deletingTenant, setDeletingTenant] = useState(false);

  // Inspect Tenant Modal
  const [inspectTenantModalOpen, setInspectTenantModalOpen] = useState(false);
  const [inspectedTenant, setInspectedTenant] = useState<TenantItem | null>(null);

  // Delete User Modal
  const [deleteUserModalOpen, setDeleteUserModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);

  // Super Admin Role Toggle
  const [togglingSuperAdminUid, setTogglingSuperAdminUid] = useState<string | null>(null);

  // Guard: super_admin only
  useEffect(() => {
    if (!loading && !isSuperAdmin && role !== 'super_admin') {
      router.replace('/');
    }
  }, [role, isSuperAdmin, loading, router]);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  // Load Platform Overview (Tenants, Users, Metrics, Logs)
  const loadOverview = useCallback(async () => {
    if (!isSuperAdmin && role !== 'super_admin') return;
    setFetchingOverview(true);
    try {
      // Force token refresh to make sure latest custom claims are sent
      if (currentUser) {
        await currentUser.getIdToken(true);
      }
      const fn = httpsCallable<unknown, {
        tenants: TenantItem[];
        users: UserItem[];
        metrics: PlatformMetrics;
        recent_logs: SystemAuditItem[];
        success: boolean;
      }>(functions, 'getPlatformOverview');
      const { data } = await fn({});
      setTenants(data.tenants || []);
      setUsers(data.users || []);
      setMetrics(data.metrics || null);
      setRecentLogs(data.recent_logs || []);
    } catch (err: unknown) {
      console.error('Failed to load platform overview:', err);
      const errMsg = err instanceof Error ? err.message : 'Failed to load software platform data.';
      showToast(errMsg, 'error');
    } finally {
      setFetchingOverview(false);
    }
  }, [isSuperAdmin, role, currentUser]);

  // Load PCO Config
  const loadConfig = useCallback(async () => {
    if (!isSuperAdmin && role !== 'super_admin') return;
    setFetchingConfig(true);
    try {
      if (currentUser) {
        await currentUser.getIdToken(true);
      }
      const fn = httpsCallable<unknown, PlatformConfigDisplay>(functions, 'getPlatformConfigCallable');
      const { data } = await fn({});
      setConfig(data);
      if (data.pco_client_id) setClientId(data.pco_client_id);
      if (data.redirect_uri) setRedirectUri(data.redirect_uri);
    } catch {
      setConfig({ exists: false });
    } finally {
      setFetchingConfig(false);
    }
  }, [isSuperAdmin, role, currentUser]);

  useEffect(() => {
    loadOverview();
    loadConfig();
  }, [loadOverview, loadConfig]);

  // Handle Save PCO Credentials
  async function handleSaveConfig() {
    setSavingConfig(true);
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
      showToast('Global PCO OAuth credentials updated successfully.', 'success');
      setClientSecret('');
      setShowSecret(false);
      loadConfig();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update credentials';
      showToast(msg, 'error');
    } finally {
      setSavingConfig(false);
    }
  }

  // Handle Delete Tenant
  async function handleDeleteTenantConfirm() {
    if (!selectedTenant) return;
    if (confirmTenantName.trim() !== selectedTenant.name.trim()) {
      showToast('Tenant name does not match confirmation input.', 'error');
      return;
    }

    setDeletingTenant(true);
    try {
      const fn = httpsCallable<{ targetOrgId: string }, { success: boolean }>(functions, 'adminDeleteTenant');
      await fn({ targetOrgId: selectedTenant.id });
      showToast(`Tenant "${selectedTenant.name}" and all subcollections deleted successfully.`, 'success');
      setDeleteTenantModalOpen(false);
      setSelectedTenant(null);
      setConfirmTenantName('');
      loadOverview();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete tenant.';
      showToast(msg, 'error');
    } finally {
      setDeletingTenant(false);
    }
  }

  // Handle Delete User
  async function handleDeleteUserConfirm() {
    if (!selectedUser) return;
    setDeletingUser(true);
    try {
      const fn = httpsCallable<{ targetUid: string }, { success: boolean }>(functions, 'adminDeleteUser');
      await fn({ targetUid: selectedUser.uid });
      showToast(`User "${selectedUser.display_name}" deleted successfully.`, 'success');
      setDeleteUserModalOpen(false);
      setSelectedUser(null);
      loadOverview();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete user.';
      showToast(msg, 'error');
    } finally {
      setDeletingUser(false);
    }
  }

  // Handle Toggle Super Admin
  async function handleToggleSuperAdmin(targetUser: UserItem) {
    const nextStatus = !targetUser.is_super_admin;
    setTogglingSuperAdminUid(targetUser.uid);
    try {
      const fn = httpsCallable<{ targetUid: string; isSuperAdmin: boolean }, { success: boolean }>(
        functions,
        'adminSetUserSuperAdmin'
      );
      await fn({ targetUid: targetUser.uid, isSuperAdmin: nextStatus });
      showToast(
        nextStatus
          ? `Granted Super Admin privileges to ${targetUser.display_name}.`
          : `Revoked Super Admin privileges from ${targetUser.display_name}.`,
        'success'
      );
      loadOverview();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update user role.';
      showToast(msg, 'error');
    } finally {
      setTogglingSuperAdminUid(null);
    }
  }

  // Handle Switch to Tenant / Impersonation
  function handleImpersonateTenant(tenant: TenantItem) {
    setImpersonatedOrgId(tenant.id);
    showToast(`Switched active context to tenant: ${tenant.name}`, 'success');
    router.push('/');
  }

  // ─── Filtered Data ──────────────────────────────────────────────────────────

  const filteredTenants = useMemo(() => {
    return tenants.filter((t) => {
      const matchesSearch =
        t.name.toLowerCase().includes(tenantSearch.toLowerCase()) ||
        t.id.toLowerCase().includes(tenantSearch.toLowerCase()) ||
        t.slug.toLowerCase().includes(tenantSearch.toLowerCase());

      if (!matchesSearch) return false;

      if (tenantFilter === 'pco') return t.pco_connected;
      if (tenantFilter === 'agent') return t.unifi_mode === 'agent';
      if (tenantFilter === 'remote') return t.unifi_mode === 'remote';
      return true;
    });
  }, [tenants, tenantSearch, tenantFilter]);

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchesSearch =
        u.display_name.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.uid.toLowerCase().includes(userSearch.toLowerCase());

      if (!matchesSearch) return false;

      if (userRoleFilter === 'super_admin') return u.is_super_admin;
      if (userRoleFilter !== 'all') {
        const roles = Object.values(u.memberships).map((m) => m.role);
        return roles.includes(userRoleFilter);
      }
      return true;
    });
  }, [users, userSearch, userRoleFilter]);

  // ─── Chart Data Preparations ────────────────────────────────────────────────

  const integrationDonutData: DonutSegment[] = useMemo(() => {
    if (!metrics) return [];
    return [
      { label: 'PCO Connected', value: metrics.pco_connected_tenants, color: '#2465F5' },
      { label: 'PCO Unlinked', value: Math.max(0, metrics.total_tenants - metrics.pco_connected_tenants), color: '#64748b' },
    ];
  }, [metrics]);

  const unifiHardwareDonutData: DonutSegment[] = useMemo(() => {
    if (!metrics) return [];
    const unconfigured = Math.max(0, metrics.total_tenants - metrics.unifi_agent_tenants - metrics.unifi_remote_tenants);
    return [
      { label: 'Local Agent', value: metrics.unifi_agent_tenants, color: '#10b981' },
      { label: 'Direct Remote', value: metrics.unifi_remote_tenants, color: '#f59e0b' },
      { label: 'Unconfigured', value: unconfigured, color: '#475569' },
    ];
  }, [metrics]);

  const rolesDonutData: DonutSegment[] = useMemo(() => {
    if (!metrics) return [];
    return [
      { label: 'Super Admin', value: metrics.roles_distribution.super_admin, color: '#ec4899' },
      { label: 'Org Admin', value: metrics.roles_distribution.org_admin, color: '#2465F5' },
      { label: 'Manager', value: metrics.roles_distribution.manager, color: '#10b981' },
      { label: 'Viewer', value: metrics.roles_distribution.viewer, color: '#94a3b8' },
    ];
  }, [metrics]);

  const growthTimelineData: AreaDataPoint[] = useMemo(() => {
    if (!metrics?.signup_timeline) return [];
    return metrics.signup_timeline.map((item) => ({
      label: item.period,
      value: item.tenants,
      secondaryValue: item.users,
    }));
  }, [metrics]);

  const tenantDoorRankingsData: BarDataPoint[] = useMemo(() => {
    return [...tenants]
      .sort((a, b) => b.door_count - a.door_count)
      .slice(0, 7)
      .map((t) => ({
        label: t.name,
        value: t.door_count,
        subLabel: `${t.schedule_window_count} schedules`,
      }));
  }, [tenants]);

  if (loading || (!isSuperAdmin && role !== 'super_admin')) return null;

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Toast */}
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

      {/* Header Banner */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
            <span className="badge badge-warning" style={{ fontSize: '0.7rem', letterSpacing: '0.05em' }}>SOFTWARE ADMIN</span>
            <h1 className="page-title" style={{ margin: 0 }}>Platform Administration</h1>
          </div>
          <p style={{ color: 'var(--color-text-secondary)', margin: 0, fontSize: '0.9375rem' }}>
            Multi-tenant control center, global OAuth credentials, user authorization, and system health metrics.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              loadOverview();
              loadConfig();
            }}
            disabled={fetchingOverview}
            style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
          >
            <RefreshIcon />
            {fetchingOverview ? 'Refreshing…' : 'Refresh Data'}
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        borderBottom: '1px solid var(--color-border)',
        overflowX: 'auto',
        paddingBottom: '0.25rem',
      }}>
        {[
          { id: 'overview', label: '📊 Overview & Stats' },
          { id: 'tenants', label: `🏢 Tenants (${tenants.length})` },
          { id: 'users', label: `👥 Platform Users (${users.length})` },
          { id: 'credentials', label: '🔑 Global PCO OAuth' },
          { id: 'fleet', label: '⚡ Agent Fleet & Health' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            style={{
              padding: '0.625rem 1.25rem',
              borderBottom: activeTab === tab.id ? '2px solid var(--color-accent)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--color-accent)' : 'var(--color-text-muted)',
              fontWeight: activeTab === tab.id ? 600 : 400,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.9375rem',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* TAB 1: OVERVIEW & STATS                                                */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Key Metric KPI Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '1rem',
          }}>
            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Total Tenants
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-primary)', marginTop: '0.25rem' }}>
                {metrics ? metrics.total_tenants : tenants.length}
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--color-success)', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span>●</span>
                {metrics && metrics.total_tenants > 0
                  ? `${Math.round((metrics.pco_connected_tenants / metrics.total_tenants) * 100)}% PCO Connected`
                  : 'No active tenants'}
              </div>
            </div>

            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Platform Users
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-primary)', marginTop: '0.25rem' }}>
                {metrics ? metrics.total_users : users.length}
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--color-accent)', marginTop: '0.5rem' }}>
                {metrics ? `${metrics.active_users_30d} signed in recently (30d)` : 'Active users'}
              </div>
            </div>

            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Managed Doors
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-primary)', marginTop: '0.25rem' }}>
                {metrics ? metrics.total_doors : '—'}
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
                Across all customer organizations
              </div>
            </div>

            <div className="card" style={{ padding: '1.25rem' }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Automation Mappings
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-primary)', marginTop: '0.25rem' }}>
                {metrics ? metrics.total_mappings : '—'}
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
                {metrics ? `${metrics.total_schedule_windows} active schedule windows` : 'Schedules'}
              </div>
            </div>
          </div>

          {/* Charts Row 1: Signups Timeline & Integration Health */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
            gap: '1.5rem',
          }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--color-text-primary)' }}>
                  Platform Growth (Monthly Signups)
                </h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Tenants vs Users</span>
              </div>
              <AreaChart
                data={growthTimelineData}
                height={220}
                primaryLabel="New Tenants"
                secondaryLabel="New Users"
                color="#2465F5"
                secondaryColor="#10b981"
                emptyMessage="No historical signup data found"
              />
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--color-text-primary)' }}>
                  UniFi Hardware Connection Mode
                </h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Tenant deployments</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem 0' }}>
                <DonutChart
                  data={unifiHardwareDonutData}
                  size={190}
                  strokeWidth={24}
                  centerTitle={`${metrics?.total_tenants || 0}`}
                  centerSubtitle="Tenants"
                  emptyMessage="No tenants registered"
                />
              </div>
            </div>
          </div>

          {/* Charts Row 2: Role Breakdown & Door Rankings */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
            gap: '1.5rem',
          }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--color-text-primary)' }}>
                  User Role Distribution
                </h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Platform accounts</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem 0' }}>
                <DonutChart
                  data={rolesDonutData}
                  size={190}
                  strokeWidth={24}
                  centerTitle={`${metrics?.total_users || 0}`}
                  centerSubtitle="Users"
                  emptyMessage="No users registered"
                />
              </div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--color-text-primary)' }}>
                  Top Tenants by Door Count
                </h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Facility volume</span>
              </div>
              <BarChart
                data={tenantDoorRankingsData}
                height={220}
                color="#2465F5"
                horizontal={true}
                valueSuffix=" doors"
                emptyMessage="No door telemetry available"
              />
            </div>
          </div>

          {/* Cross-Tenant Recent Activity Logs */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--color-text-primary)' }}>
                Recent Cross-Tenant Audit Events
              </h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Latest 25 events</span>
            </div>

            {recentLogs.length === 0 ? (
              <div style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', padding: '1rem 0', textAlign: 'center' }}>
                No recent system audit logs recorded.
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Tenant</th>
                      <th>Event / Action</th>
                      <th>Actor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentLogs.map((log) => {
                      const tenantName = tenants.find((t) => t.id === log.org_id)?.name || log.org_id;
                      return (
                        <tr key={log.id}>
                          <td style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                            {safeFormatDistanceToNow(log.timestamp)}
                          </td>
                          <td style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>
                            {tenantName}
                          </td>
                          <td>
                            <code style={{ fontSize: '0.8125rem' }}>{log.action}</code>
                          </td>
                          <td style={{ color: 'var(--color-text-secondary)', fontSize: '0.8125rem' }}>
                            {log.actor_name}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* TAB 2: TENANTS MANAGEMENT                                              */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'tenants' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Search & Filter Toolbar */}
          <div className="card" style={{ padding: '0.875rem 1.25rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '220px' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Search tenants by name or ID…"
                value={tenantSearch}
                onChange={(e) => setTenantSearch(e.target.value)}
                style={{ padding: '0.5rem 0.75rem', fontSize: '0.875rem' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {(['all', 'pco', 'agent', 'remote'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setTenantFilter(mode)}
                  className={`btn btn-sm ${tenantFilter === mode ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ textTransform: 'capitalize', fontSize: '0.8125rem' }}
                >
                  {mode === 'all' ? 'All Tenants' : mode === 'pco' ? 'PCO Connected' : mode === 'agent' ? 'Local Agent' : 'Remote'}
                </button>
              ))}
            </div>
          </div>

          {/* Tenants Table */}
          {fetchingOverview ? (
            <div className="card skeleton" style={{ height: '16rem' }} />
          ) : filteredTenants.length === 0 ? (
            <div className="card empty-state">
              <p className="empty-state-title">No matching tenants found</p>
              <p className="empty-state-text">Try adjusting your search criteria or clear the active filter.</p>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Organization / Tenant</th>
                    <th>Slug & Org ID</th>
                    <th>Integrations</th>
                    <th>Doors & Windows</th>
                    <th>Members</th>
                    <th>Created</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTenants.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{t.name}</span>
                          {t.pco_org_name && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                              PCO: {t.pco_org_name}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>/{t.slug}</span>
                          <code style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{t.id}</code>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                          <span className={`badge ${t.pco_connected ? 'badge-success' : 'badge-neutral'}`} style={{ fontSize: '0.7rem' }}>
                            {t.pco_connected ? 'PCO Connected' : 'No PCO'}
                          </span>
                          <span className={`badge ${t.unifi_mode === 'agent' ? 'badge-info' : t.unifi_mode === 'remote' ? 'badge-warning' : 'badge-neutral'}`} style={{ fontSize: '0.7rem' }}>
                            {t.unifi_mode === 'agent' ? 'UniFi Agent' : t.unifi_mode === 'remote' ? 'UniFi Remote' : 'No UniFi'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-primary)' }}>
                          <strong>{t.door_count}</strong> doors · <strong>{t.schedule_window_count}</strong> windows
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          {t.mapping_count} resource mappings
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                          {t.member_count} member{t.member_count !== 1 ? 's' : ''}
                        </span>
                      </td>
                      <td style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                        {t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.375rem', justifyContent: 'flex-end' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            title="Inspect complete configuration"
                            onClick={() => {
                              setInspectedTenant(t);
                              setInspectTenantModalOpen(true);
                            }}
                          >
                            <InfoIcon />
                            Inspect
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            title="Switch dashboard view to this tenant"
                            onClick={() => handleImpersonateTenant(t)}
                          >
                            <EyeIcon />
                            View As
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--color-danger)' }}
                            title="Delete tenant permanently"
                            onClick={() => {
                              setSelectedTenant(t);
                              setConfirmTenantName('');
                              setDeleteTenantModalOpen(true);
                            }}
                          >
                            <TrashIcon />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* TAB 3: PLATFORM USERS MANAGEMENT                                      */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'users' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Search & Filter Toolbar */}
          <div className="card" style={{ padding: '0.875rem 1.25rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '220px' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Search users by name, email, or UID…"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                style={{ padding: '0.5rem 0.75rem', fontSize: '0.875rem' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {(['all', 'super_admin', 'org_admin', 'manager', 'viewer'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setUserRoleFilter(r)}
                  className={`btn btn-sm ${userRoleFilter === r ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ textTransform: 'capitalize', fontSize: '0.8125rem' }}
                >
                  {r === 'all' ? 'All Roles' : r.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Users Table */}
          {fetchingOverview ? (
            <div className="card skeleton" style={{ height: '16rem' }} />
          ) : filteredUsers.length === 0 ? (
            <div className="card empty-state">
              <p className="empty-state-title">No matching users found</p>
              <p className="empty-state-text">Try adjusting your search query or role filter.</p>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>User & Account</th>
                    <th>Email Address</th>
                    <th>Assigned Organizations & Roles</th>
                    <th>Last Sign-In</th>
                    <th>Created</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => {
                    const tenantIds = Object.keys(u.memberships);
                    const isSelf = u.uid === currentUser?.uid;

                    return (
                      <tr key={u.uid}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                            <div style={{
                              width: '2rem', height: '2rem', borderRadius: '50%',
                              background: u.is_super_admin ? 'var(--color-warning)' : 'var(--color-accent)',
                              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '0.8125rem', fontWeight: 700, flexShrink: 0,
                            }}>
                              {(u.display_name || u.email || 'U')[0].toUpperCase()}
                            </div>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                                <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                  {u.display_name}
                                </span>
                                {isSelf && (
                                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>(you)</span>
                                )}
                              </div>
                              <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.125rem' }}>
                                {u.is_super_admin && (
                                  <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>SUPER ADMIN</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
                          {u.email}
                        </td>
                        <td>
                          {tenantIds.length === 0 ? (
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>No org memberships</span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              {tenantIds.map((tid) => {
                                const tName = tenants.find((t) => t.id === tid)?.name ?? tid;
                                const rLabel = u.memberships[tid]?.role ?? 'viewer';
                                return (
                                  <div key={tid} style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                                    <strong>{tName}</strong> <span style={{ opacity: 0.7 }}>({rLabel})</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 500, color: 'var(--color-text-primary)', fontSize: '0.8125rem' }}>
                              {u.last_sign_in_time ? safeFormatDistanceToNow(u.last_sign_in_time) : 'Never'}
                            </span>
                            {u.last_sign_in_time && (
                              <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                                {new Date(u.last_sign_in_time).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                          {u.creation_time ? new Date(u.creation_time).toLocaleDateString() : '—'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.375rem', justifyContent: 'flex-end' }}>
                            {!isSelf && (
                              <button
                                className={`btn btn-sm ${u.is_super_admin ? 'btn-secondary' : 'btn-primary'}`}
                                style={{ fontSize: '0.75rem' }}
                                disabled={togglingSuperAdminUid === u.uid}
                                onClick={() => handleToggleSuperAdmin(u)}
                                title={u.is_super_admin ? 'Revoke Super Admin privileges' : 'Promote to Super Admin'}
                              >
                                <ShieldCheckIcon />
                                {togglingSuperAdminUid === u.uid
                                  ? 'Saving…'
                                  : u.is_super_admin
                                  ? 'Demote'
                                  : 'Make Admin'}
                              </button>
                            )}
                            {!isSelf && (
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{ color: 'var(--color-danger)' }}
                                title="Delete user permanently"
                                onClick={() => {
                                  setSelectedUser(u);
                                  setDeleteUserModalOpen(true);
                                }}
                              >
                                <TrashIcon />
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* TAB 4: GLOBAL PCO OAUTH CREDENTIALS                                   */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'credentials' && (
        <div style={{ maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                Planning Center Developer OAuth Application
              </h2>
              {config?.exists && <span className="badge badge-success">Configured</span>}
              {config && !config.exists && <span className="badge badge-danger">Not Set</span>}
            </div>

            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
              Configure the platform-level OAuth Client ID and Secret from your Planning Center Developer Portal at{' '}
              <a href="https://api.planningcenteronline.com/oauth/applications" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)' }}>
                api.planningcenteronline.com/oauth/applications
              </a>.
            </p>

            {fetchingConfig ? (
              <div style={{ color: 'var(--color-text-muted)', padding: '1rem 0' }}>Loading current credentials…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="pco-client-id">Application Client ID</label>
                  <input
                    id="pco-client-id"
                    className="form-input"
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="e.g. e96a9abe393119e8..."
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="pco-client-secret">
                    Application Client Secret {config?.exists ? '(leave blank to keep existing)' : ''}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="pco-client-secret"
                      className="form-input"
                      type={showSecret ? 'text' : 'password'}
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder={config?.exists ? '••••••••••••••••••••••••' : 'pco_app_secret_...'}
                      style={{ paddingRight: '2.75rem' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((v) => !v)}
                      style={{
                        position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0,
                      }}
                    >
                      {showSecret ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="redirect-uri">OAuth Redirect Callback URI</label>
                  <input
                    id="redirect-uri"
                    className="form-input"
                    type="url"
                    value={redirectUri}
                    onChange={(e) => setRedirectUri(e.target.value)}
                  />
                </div>

                <div>
                  <button className="btn btn-primary" onClick={handleSaveConfig} disabled={savingConfig || !clientId.trim()}>
                    {savingConfig ? 'Saving…' : config?.exists ? 'Update Credentials' : 'Save Credentials'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* TAB 5: AGENT FLEET & HEALTH                                           */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'fleet' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card">
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '0.5rem' }}>
              On-Premise UniFi Access Agent Fleet
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
              Status of all registered local daemon agents installed at customer facilities across all organizations.
            </p>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Connection Mode</th>
                    <th>Local Host / IP</th>
                    <th>Token Configured</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{t.name}</td>
                      <td>
                        <span className={`badge ${t.unifi_mode === 'agent' ? 'badge-info' : t.unifi_mode === 'remote' ? 'badge-warning' : 'badge-neutral'}`}>
                          {t.unifi_mode === 'agent' ? 'Local Agent' : t.unifi_mode === 'remote' ? 'Remote Cloud' : 'Unconfigured'}
                        </span>
                      </td>
                      <td>
                        {t.agent_status?.auto_discovered_host ? (
                          <code style={{ fontSize: '0.8125rem' }}>{t.agent_status.auto_discovered_host}</code>
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>—</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${t.agent_status?.has_token ? 'badge-success' : 'badge-neutral'}`} style={{ fontSize: '0.7rem' }}>
                          {t.agent_status?.has_token ? 'Enrolled' : 'None'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${t.unifi_mode !== 'unconfigured' ? 'badge-success' : 'badge-neutral'}`}>
                          {t.unifi_mode !== 'unconfigured' ? 'Online' : 'Standby'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* MODAL: INSPECT TENANT DETAILS                                         */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      <Modal
        isOpen={inspectTenantModalOpen}
        onClose={() => setInspectTenantModalOpen(false)}
        title={`Tenant Details: ${inspectedTenant?.name}`}
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            {inspectedTenant && (
              <button className="btn btn-primary" onClick={() => handleImpersonateTenant(inspectedTenant)}>
                <EyeIcon /> View As Tenant
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => setInspectTenantModalOpen(false)}>
              Close
            </button>
          </div>
        }
      >
        {inspectedTenant && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.875rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>Tenant Name</div>
                <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{inspectedTenant.name}</div>
              </div>
              <div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>Organization ID</div>
                <code>{inspectedTenant.id}</code>
              </div>
              <div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>Timezone</div>
                <div>{inspectedTenant.timezone || 'America/Chicago'}</div>
              </div>
              <div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>Created Date</div>
                <div>{inspectedTenant.created_at ? new Date(inspectedTenant.created_at).toLocaleString() : '—'}</div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
              <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '0.5rem' }}>
                Hardware & Integration Metrics
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                <div className="card" style={{ padding: '0.625rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>{inspectedTenant.door_count}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Doors</div>
                </div>
                <div className="card" style={{ padding: '0.625rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>{inspectedTenant.schedule_window_count}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Windows</div>
                </div>
                <div className="card" style={{ padding: '0.625rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>{inspectedTenant.member_count}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Members</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* MODAL: DELETE TENANT                                                  */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      <Modal
        isOpen={deleteTenantModalOpen}
        onClose={() => !deletingTenant && setDeleteTenantModalOpen(false)}
        title={`Delete Tenant: ${selectedTenant?.name}`}
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => setDeleteTenantModalOpen(false)} disabled={deletingTenant}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={handleDeleteTenantConfirm}
              disabled={deletingTenant || confirmTenantName.trim() !== selectedTenant?.name.trim()}
            >
              {deletingTenant ? 'Deleting Tenant & Data…' : 'Permanently Delete Tenant'}
            </button>
          </div>
        }
      >
        <p style={{ color: 'var(--color-danger)', fontWeight: 600, marginBottom: '0.5rem' }}>
          ⚠️ Warning: Destructive Action
        </p>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
          Are you sure you want to permanently delete tenant <strong style={{ color: 'var(--color-text-primary)' }}>{selectedTenant?.name}</strong>?
        </p>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
          This will permanently purge all associated doors, schedule windows, mappings, campuses, agent tokens, visitors, audit logs, and scrub references from all user profiles.
        </p>
        <div style={{ marginTop: '1rem' }}>
          <label className="form-label" style={{ fontSize: '0.8125rem' }}>
            Type <strong>{selectedTenant?.name}</strong> to confirm:
          </label>
          <input
            type="text"
            className="form-input"
            value={confirmTenantName}
            onChange={(e) => setConfirmTenantName(e.target.value)}
            placeholder={selectedTenant?.name}
          />
        </div>
      </Modal>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* MODAL: DELETE USER                                                    */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      <Modal
        isOpen={deleteUserModalOpen}
        onClose={() => !deletingUser && setDeleteUserModalOpen(false)}
        title={`Delete User: ${selectedUser?.display_name}`}
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => setDeleteUserModalOpen(false)} disabled={deletingUser}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={handleDeleteUserConfirm} disabled={deletingUser}>
              {deletingUser ? 'Deleting User…' : 'Delete User'}
            </button>
          </div>
        }
      >
        <p style={{ color: 'var(--color-danger)', fontWeight: 600, marginBottom: '0.5rem' }}>
          ⚠️ Permanently Delete User Account
        </p>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
          Are you sure you want to delete user <strong style={{ color: 'var(--color-text-primary)' }}>{selectedUser?.display_name}</strong> ({selectedUser?.email})?
        </p>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
          This will permanently delete their Firebase Auth login credentials and Firestore profile document.
        </p>
      </Modal>
    </div>
  );
}
