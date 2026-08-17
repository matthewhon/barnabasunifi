'use client';

import { useEffect, useState, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import Modal from '@/components/ui/Modal';
import { formatDistanceToNow } from 'date-fns';

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
  member_count: number;
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

export default function AdminPlatformPage() {
  const { role, loading, user: currentUser } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'credentials' | 'tenants' | 'users'>('credentials');

  const [config, setConfig] = useState<PlatformConfigDisplay | null>(null);
  const [fetchingConfig, setFetchingConfig] = useState(true);

  // Overview state
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [fetchingOverview, setFetchingOverview] = useState(false);

  // Form state for PCO credentials
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState(
    'https://us-central1-barnabasunfi.cloudfunctions.net/pcoOAuthCallback',
  );
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Delete Tenant Modal
  const [deleteTenantModalOpen, setDeleteTenantModalOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<TenantItem | null>(null);
  const [deletingTenant, setDeletingTenant] = useState(false);

  // Delete User Modal
  const [deleteUserModalOpen, setDeleteUserModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);

  // Guard: super_admin only
  useEffect(() => {
    if (!loading && role !== 'super_admin') {
      router.replace('/');
    }
  }, [role, loading, router]);

  // Load PCO config
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
      .finally(() => setFetchingConfig(false));
  }, [role]);

  // Load Overview (Tenants + Users)
  const loadOverview = useCallback(async () => {
    if (role !== 'super_admin') return;
    setFetchingOverview(true);
    try {
      const fn = httpsCallable<unknown, { tenants: TenantItem[]; users: UserItem[]; success: boolean }>(
        functions,
        'getPlatformOverview'
      );
      const { data } = await fn({});
      setTenants(data.tenants || []);
      setUsers(data.users || []);
    } catch {
      showToast('Failed to load platform overview.', 'error');
    } finally {
      setFetchingOverview(false);
    }
  }, [role]);

  useEffect(() => {
    if (activeTab === 'tenants' || activeTab === 'users') {
      loadOverview();
    }
  }, [activeTab, loadOverview]);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleSaveConfig() {
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
      setClientSecret('');
      setShowSecret(false);
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

  async function handleDeleteTenantConfirm() {
    if (!selectedTenant) return;
    setDeletingTenant(true);
    try {
      const fn = httpsCallable<{ targetOrgId: string }, { success: boolean }>(functions, 'adminDeleteTenant');
      await fn({ targetOrgId: selectedTenant.id });
      showToast(`Tenant "${selectedTenant.name}" deleted successfully.`, 'success');
      setDeleteTenantModalOpen(false);
      setSelectedTenant(null);
      loadOverview();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete tenant.';
      showToast(msg, 'error');
    } finally {
      setDeletingTenant(false);
    }
  }

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

      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>SUPER ADMIN</span>
          <h1 className="page-title" style={{ margin: 0 }}>Platform Administration</h1>
        </div>
        <p style={{ color: 'var(--color-text-secondary)', marginTop: '0.4rem' }}>
          Manage global OAuth credentials, all registered tenants, and platform user accounts.
        </p>
      </div>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--color-border)', marginBottom: '1.5rem' }}>
        <button
          onClick={() => setActiveTab('credentials')}
          style={{
            padding: '0.625rem 1.25rem',
            borderBottom: activeTab === 'credentials' ? '2px solid var(--color-accent)' : '2px solid transparent',
            color: activeTab === 'credentials' ? 'var(--color-accent)' : 'var(--color-text-muted)',
            fontWeight: activeTab === 'credentials' ? 600 : 400,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.9375rem',
          }}
        >
          PCO Credentials
        </button>
        <button
          onClick={() => setActiveTab('tenants')}
          style={{
            padding: '0.625rem 1.25rem',
            borderBottom: activeTab === 'tenants' ? '2px solid var(--color-accent)' : '2px solid transparent',
            color: activeTab === 'tenants' ? 'var(--color-accent)' : 'var(--color-text-muted)',
            fontWeight: activeTab === 'tenants' ? 600 : 400,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.9375rem',
          }}
        >
          Tenants ({tenants.length})
        </button>
        <button
          onClick={() => setActiveTab('users')}
          style={{
            padding: '0.625rem 1.25rem',
            borderBottom: activeTab === 'users' ? '2px solid var(--color-accent)' : '2px solid transparent',
            color: activeTab === 'users' ? 'var(--color-accent)' : 'var(--color-text-muted)',
            fontWeight: activeTab === 'users' ? 600 : 400,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.9375rem',
          }}
        >
          Platform Users ({users.length})
        </button>
      </div>

      {/* ─── TAB 1: PCO Credentials ─── */}
      {activeTab === 'credentials' && (
        <div style={{ maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                Planning Center OAuth App
              </h2>
              {config?.exists && <span className="badge badge-success">Configured</span>}
              {config && !config.exists && <span className="badge badge-danger">Not Set</span>}
            </div>

            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
              These credentials come from your OAuth application at{' '}
              <a href="https://api.planningcenteronline.com/oauth/applications" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)' }}>
                api.planningcenteronline.com/oauth/applications
              </a>.
            </p>

            {fetchingConfig ? (
              <div style={{ color: 'var(--color-text-muted)', padding: '1rem 0' }}>Loading current config…</div>
            ) : (
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
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="pco-client-secret">
                    Client Secret {config?.exists ? '(leave blank to keep existing)' : ''}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="pco-client-secret"
                      className="form-input"
                      type={showSecret ? 'text' : 'password'}
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder={config?.exists ? '••••••••••••••••••••••••' : 'pco_app_...'}
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
                  <label className="form-label" htmlFor="redirect-uri">OAuth Redirect URI</label>
                  <input
                    id="redirect-uri"
                    className="form-input"
                    type="url"
                    value={redirectUri}
                    onChange={(e) => setRedirectUri(e.target.value)}
                  />
                </div>

                <div>
                  <button className="btn btn-primary" onClick={handleSaveConfig} disabled={saving || !clientId.trim()}>
                    {saving ? 'Saving…' : config?.exists ? 'Update Credentials' : 'Save Credentials'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB 2: Tenants Management ─── */}
      {activeTab === 'tenants' && (
        <div>
          {fetchingOverview ? (
            <div className="card skeleton" style={{ height: '12rem' }} />
          ) : tenants.length === 0 ? (
            <div className="card empty-state">
              <p className="empty-state-title">No tenants found</p>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Tenant Name</th>
                    <th>Org ID / Slug</th>
                    <th>PCO Status</th>
                    <th>Members</th>
                    <th>Created Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{t.name}</td>
                      <td>
                        <code style={{ fontSize: '0.8rem' }}>{t.id}</code>
                      </td>
                      <td>
                        <span className={`badge ${t.pco_connected ? 'badge-success' : 'badge-neutral'}`}>
                          {t.pco_connected ? 'Connected' : 'Not Connected'}
                        </span>
                      </td>
                      <td>{t.member_count} member{t.member_count !== 1 ? 's' : ''}</td>
                      <td style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>
                        {t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}
                      </td>
                      <td>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--color-danger)' }}
                          onClick={() => {
                            setSelectedTenant(t);
                            setDeleteTenantModalOpen(true);
                          }}
                        >
                          <TrashIcon />
                          Delete Tenant
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 3: Platform Users Management (With Last Login Time) ─── */}
      {activeTab === 'users' && (
        <div>
          {fetchingOverview ? (
            <div className="card skeleton" style={{ height: '12rem' }} />
          ) : users.length === 0 ? (
            <div className="card empty-state">
              <p className="empty-state-title">No platform users found</p>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Email</th>
                    <th>Tenants / Roles</th>
                    <th>Last Sign-In</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const tenantIds = Object.keys(u.memberships);
                    return (
                      <tr key={u.uid}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                              {u.display_name}
                            </span>
                            {u.is_super_admin && (
                              <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>SUPER ADMIN</span>
                            )}
                            {u.uid === currentUser?.uid && (
                              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>(you)</span>
                            )}
                          </div>
                        </td>
                        <td style={{ color: 'var(--color-text-secondary)' }}>{u.email}</td>
                        <td>
                          {tenantIds.length === 0 ? (
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>No assigned orgs</span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              {tenantIds.map((tid) => {
                                const tName = tenants.find((t) => t.id === tid)?.name ?? tid;
                                const rLabel = u.memberships[tid]?.role ?? 'viewer';
                                return (
                                  <div key={tid} style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                                    <strong>{tName}</strong> ({rLabel})
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                        <td>
                          <span style={{ fontWeight: 500, color: 'var(--color-text-primary)', fontSize: '0.8125rem' }}>
                            {u.last_sign_in_time
                              ? formatDistanceToNow(new Date(u.last_sign_in_time), { addSuffix: true })
                              : 'Never signed in'}
                          </span>
                        </td>
                        <td style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>
                          {u.creation_time ? new Date(u.creation_time).toLocaleDateString() : '—'}
                        </td>
                        <td>
                          {u.uid !== currentUser?.uid && (
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ color: 'var(--color-danger)' }}
                              onClick={() => {
                                setSelectedUser(u);
                                setDeleteUserModalOpen(true);
                              }}
                            >
                              <TrashIcon />
                              Delete User
                            </button>
                          )}
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

      {/* Delete Tenant Modal */}
      <Modal
        isOpen={deleteTenantModalOpen}
        onClose={() => !deletingTenant && setDeleteTenantModalOpen(false)}
        title={`Delete Tenant: ${selectedTenant?.name}`}
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => setDeleteTenantModalOpen(false)} disabled={deletingTenant}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={handleDeleteTenantConfirm} disabled={deletingTenant}>
              {deletingTenant ? 'Deleting Tenant…' : 'Delete Tenant'}
            </button>
          </div>
        }
      >
        <p style={{ color: 'var(--color-danger)', fontWeight: 600, marginBottom: '0.5rem' }}>
          ⚠️ Warning: High Impact Action
        </p>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Are you sure you want to permanently delete tenant <strong style={{ color: 'var(--color-text-primary)' }}>{selectedTenant?.name}</strong>?
        </p>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.75rem' }}>
          This will permanently purge all associated doors, schedule windows, mappings, audit logs, and user membership references.
        </p>
      </Modal>

      {/* Delete User Modal */}
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
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Are you sure you want to delete user <strong style={{ color: 'var(--color-text-primary)' }}>{selectedUser?.display_name}</strong> ({selectedUser?.email})?
        </p>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.75rem' }}>
          This will permanently delete their Firebase Auth login credentials and Firestore profile document.
        </p>
      </Modal>
    </div>
  );
}
