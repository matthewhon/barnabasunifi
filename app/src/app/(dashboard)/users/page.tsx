'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import type { UserRole } from '@/lib/types';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { safeFormatDistanceToNow, safeFormat } from '@/lib/date-utils';

// ─── Role configuration ───────────────────────────────────────────────────────

const ROLES: { value: UserRole; label: string; description: string }[] = [
  { value: 'org_admin', label: 'Admin', description: 'Full access to all settings and users' },
  { value: 'manager', label: 'Manager', description: 'Can manage doors and schedule, not users' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only access' },
];

function roleBadgeClass(role: UserRole): string {
  switch (role) {
    case 'super_admin': return 'badge-danger';
    case 'org_admin': return 'badge-info';
    case 'manager': return 'badge-warning';
    case 'viewer': return 'badge-neutral';
    default: return 'badge-neutral';
  }
}

function roleLabel(role: UserRole): string {
  switch (role) {
    case 'super_admin': return 'Super Admin';
    case 'org_admin': return 'Admin';
    case 'manager': return 'Manager';
    case 'viewer': return 'Viewer';
    default: return role;
  }
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-2 2l-2 2m2-2l2 2m-4 0l2 2M5 13a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm0 0l-5 5v3h3l2.5-2.5" />
    </svg>
  );
}

// ─── OrgUser interface (combines profile + role for org) ──────────────────────

interface OrgUser {
  uid: string;
  display_name: string;
  email: string;
  role: UserRole;
  last_login_at?: string | null;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const { orgId, role: currentRole, isSuperAdmin, user: currentUser } = useAuth();
  const { showToast } = useToast();

  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('viewer');
  const [inviting, setInviting] = useState(false);

  // Remove modal
  const [removeModalOpen, setRemoveModalOpen] = useState(false);
  const [removingUser, setRemovingUser] = useState<OrgUser | null>(null);
  const [removing, setRemoving] = useState(false);

  // Reset password modal
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetUser, setResetUser] = useState<OrgUser | null>(null);
  const [resetMode, setResetMode] = useState<'email' | 'manual'>('email');
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);

  // Role change loading
  const [changingRole, setChangingRole] = useState<string | null>(null);

  const isAdmin = currentRole === 'org_admin' || isSuperAdmin;

  const fetchOrgUsers = useCallback(async () => {
    if (!orgId) return;
    try {
      const getOrgUsers = httpsCallable<
        { orgId: string },
        { users: OrgUser[]; success: boolean }
      >(functions, 'getOrgUsers');
      const res = await getOrgUsers({ orgId });
      setUsers(res.data.users || []);
    } catch {
      showToast('Failed to load users.', 'error');
    } finally {
      setLoading(false);
    }
  }, [orgId, showToast]);

  // Load org users
  useEffect(() => {
    fetchOrgUsers();
  }, [fetchOrgUsers]);

  const handleInvite = useCallback(async () => {
    if (!orgId || !inviteEmail.trim()) return;
    setInviting(true);
    try {
      const inviteUser = httpsCallable<
        { orgId: string; email: string; role: UserRole },
        { success: boolean }
      >(functions, 'inviteUser');
      await inviteUser({ orgId, email: inviteEmail.trim(), role: inviteRole });
      showToast(`Invitation sent to ${inviteEmail.trim()}.`, 'success');
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('viewer');
      fetchOrgUsers();
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? 'Failed to send invitation.';
      showToast(msg, 'error');
    } finally {
      setInviting(false);
    }
  }, [orgId, inviteEmail, inviteRole, showToast, fetchOrgUsers]);

  const handleRoleChange = useCallback(
    async (uid: string, newRole: UserRole) => {
      if (!orgId) return;
      setChangingRole(uid);
      try {
        const changeRole = httpsCallable<
          { orgId: string; targetUid: string; role: UserRole },
          { success: boolean }
        >(functions, 'changeUserRole');
        await changeRole({ orgId, targetUid: uid, role: newRole });
        setUsers((prev) =>
          prev.map((u) => (u.uid === uid ? { ...u, role: newRole } : u)),
        );
        showToast('Role updated.', 'success');
      } catch {
        showToast('Failed to change role. Please try again.', 'error');
      } finally {
        setChangingRole(null);
      }
    },
    [orgId, showToast],
  );

  const handleRemoveConfirm = useCallback(async () => {
    if (!orgId || !removingUser) return;
    setRemoving(true);
    try {
      const removeUser = httpsCallable<
        { orgId: string; targetUid: string },
        { success: boolean }
      >(functions, 'removeUser');
      await removeUser({ orgId, targetUid: removingUser.uid });
      setUsers((prev) => prev.filter((u) => u.uid !== removingUser.uid));
      setRemoveModalOpen(false);
      showToast(`${removingUser.display_name} removed from organization.`, 'success');
    } catch {
      showToast('Failed to remove user. Please try again.', 'error');
    } finally {
      setRemoving(false);
    }
  }, [orgId, removingUser, showToast]);

  const handleResetPassword = useCallback(async () => {
    if (!orgId || !resetUser) return;
    if (resetMode === 'manual' && (!newPassword || newPassword.length < 6)) {
      showToast('Password must be at least 6 characters.', 'error');
      return;
    }

    setResetting(true);
    setGeneratedLink(null);
    try {
      const adminResetPassword = httpsCallable<
        { orgId: string; targetUid: string; newPassword?: string; action: 'send_email' | 'set_password' },
        { success: boolean; message: string; resetLink?: string }
      >(functions, 'adminResetPassword');

      const res = await adminResetPassword({
        orgId,
        targetUid: resetUser.uid,
        action: resetMode === 'manual' ? 'set_password' : 'send_email',
        newPassword: resetMode === 'manual' ? newPassword : undefined,
      });

      if (res.data.resetLink) {
        setGeneratedLink(res.data.resetLink);
        showToast('Password reset link generated successfully.', 'success');
      } else {
        showToast(res.data.message || 'Password updated successfully.', 'success');
        setResetModalOpen(false);
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? 'Failed to reset password.';
      showToast(msg, 'error');
    } finally {
      setResetting(false);
    }
  }, [orgId, resetUser, resetMode, newPassword, showToast]);

  // Access check
  if (!isAdmin) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Users</h1>
        </div>
        <div className="card empty-state">
          <p className="empty-state-title" style={{ color: 'var(--color-danger)' }}>
            Access Denied
          </p>
          <p style={{ fontSize: '0.875rem' }}>
            You need org_admin or super_admin role to manage users.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Users</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setInviteOpen(true)}>
          <PlusIcon />
          Invite User
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="card" style={{ padding: '0' }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)' }}>
              <div className="skeleton" style={{ height: '1rem', width: '40%', marginBottom: '0.5rem', borderRadius: 'var(--radius-sm)' }} />
              <div className="skeleton" style={{ height: '0.75rem', width: '60%', borderRadius: 'var(--radius-sm)' }} />
            </div>
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="card empty-state">
          <p className="empty-state-title">No users yet</p>
          <p style={{ fontSize: '0.875rem' }}>Invite users to collaborate on your organization.</p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Last Login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.uid}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                      <div
                        style={{
                          width: '2rem',
                          height: '2rem',
                          borderRadius: '50%',
                          background: 'var(--color-accent)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          color: '#fff',
                          flexShrink: 0,
                        }}
                      >
                        {(u.display_name ?? u.email)[0].toUpperCase()}
                      </div>
                      <span style={{ fontWeight: 500 }}>
                        {u.display_name}
                        {u.uid === currentUser?.uid && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '0.375rem' }}>
                            (you)
                          </span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td style={{ color: 'var(--color-text-secondary)' }}>{u.email}</td>
                  <td>
                    <span className={`badge ${roleBadgeClass(u.role)}`}>
                      {roleLabel(u.role)}
                    </span>
                  </td>
                  <td style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
                    {u.last_login_at ? (
                      <span title={safeFormat(u.last_login_at, 'PPP p')}>
                        {safeFormatDistanceToNow(u.last_login_at)}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)' }}>Never</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--color-warning)', padding: '0.375rem' }}
                        onClick={() => {
                          setResetUser(u);
                          setResetMode('email');
                          setNewPassword('');
                          setGeneratedLink(null);
                          setResetModalOpen(true);
                        }}
                        title="Reset password"
                      >
                        <KeyIcon />
                      </button>

                      {u.uid !== currentUser?.uid && (
                        <>
                          <select
                            className="form-select"
                            style={{ width: 'auto', padding: '0.3125rem 2rem 0.3125rem 0.625rem', fontSize: '0.8125rem' }}
                            value={u.role}
                            onChange={(e) => handleRoleChange(u.uid, e.target.value as UserRole)}
                            disabled={changingRole === u.uid}
                          >
                            {ROLES.map((r) => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--color-danger)', padding: '0.375rem' }}
                            onClick={() => {
                              setRemovingUser(u);
                              setRemoveModalOpen(true);
                            }}
                            title="Remove user"
                          >
                            <TrashIcon />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invite Modal */}
      <Modal
        isOpen={inviteOpen}
        onClose={() => !inviting && setInviteOpen(false)}
        title="Invite User"
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => setInviteOpen(false)} disabled={inviting}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleInvite}
              disabled={inviting || !inviteEmail.trim()}
            >
              {inviting ? 'Sending…' : 'Send Invitation'}
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              type="email"
              className="form-input"
              placeholder="colleague@church.org"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              autoFocus
              disabled={inviting}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Role</label>
            <select
              className="form-select"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as UserRole)}
              disabled={inviting}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label} — {r.description}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        isOpen={resetModalOpen}
        onClose={() => !resetting && setResetModalOpen(false)}
        title={`Reset Password: ${resetUser?.display_name || ''}`}
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => setResetModalOpen(false)} disabled={resetting}>
              {generatedLink ? 'Close' : 'Cancel'}
            </button>
            {!generatedLink && (
              <button
                className="btn btn-primary"
                onClick={handleResetPassword}
                disabled={resetting || (resetMode === 'manual' && newPassword.length < 6)}
              >
                {resetting ? 'Processing…' : resetMode === 'manual' ? 'Update Password' : 'Send Reset Link'}
              </button>
            )}
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.75rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}>
              <input
                type="radio"
                name="resetMode"
                value="email"
                checked={resetMode === 'email'}
                onChange={() => { setResetMode('email'); setGeneratedLink(null); }}
                disabled={resetting}
              />
              Send Reset Link
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}>
              <input
                type="radio"
                name="resetMode"
                value="manual"
                checked={resetMode === 'manual'}
                onChange={() => { setResetMode('manual'); setGeneratedLink(null); }}
                disabled={resetting}
              />
              Set New Password
            </label>
          </div>

          {generatedLink ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-success)', fontWeight: 500 }}>
                Reset link generated! Copy and send this link to the user:
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="text"
                  readOnly
                  className="form-input"
                  value={generatedLink}
                  style={{ fontSize: '0.8125rem', fontFamily: 'monospace' }}
                />
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedLink);
                    showToast('Copied to clipboard!', 'success');
                  }}
                >
                  Copy
                </button>
              </div>
            </div>
          ) : resetMode === 'email' ? (
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
              Generate a password reset link for <strong style={{ color: 'var(--color-text-primary)' }}>{resetUser?.email}</strong>.
            </p>
          ) : (
            <div className="form-group">
              <label className="form-label">New Password</label>
              <input
                type="password"
                className="form-input"
                placeholder="Minimum 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoFocus
                disabled={resetting}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                This will immediately update the user's password in Firebase Auth.
              </span>
            </div>
          )}
        </div>
      </Modal>

      {/* Remove Confirmation Modal */}
      <Modal
        isOpen={removeModalOpen}
        onClose={() => !removing && setRemoveModalOpen(false)}
        title="Remove User"
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => setRemoveModalOpen(false)} disabled={removing}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={handleRemoveConfirm} disabled={removing}>
              {removing ? 'Removing…' : 'Remove User'}
            </button>
          </div>
        }
      >
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Remove{' '}
          <strong style={{ color: 'var(--color-text-primary)' }}>{removingUser?.display_name}</strong>{' '}
          ({removingUser?.email}) from this organization?
        </p>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.75rem' }}>
          They will lose access immediately. Their account will not be deleted.
        </p>
      </Modal>
    </div>
  );
}
