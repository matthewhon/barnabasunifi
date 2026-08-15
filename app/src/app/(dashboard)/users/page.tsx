'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import type { UserProfile, UserRole } from '@unfi-pco/shared';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

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

// ─── OrgUser interface (combines profile + role for org) ──────────────────────

interface OrgUser {
  uid: string;
  display_name: string;
  email: string;
  role: UserRole;
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

  // Role change loading
  const [changingRole, setChangingRole] = useState<string | null>(null);

  const isAdmin = currentRole === 'org_admin' || isSuperAdmin;

  // Load org users
  useEffect(() => {
    if (!orgId) return;

    async function loadUsers() {
      try {
        const snap = await getDocs(collection(db, 'users'));
        const allProfiles = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) }));

        // Filter to users who are members of this org
        const orgUsers: OrgUser[] = allProfiles
          .filter((p) => p.org_memberships?.some((m) => m.org_id === orgId))
          .map((p) => {
            const membership = p.org_memberships.find((m) => m.org_id === orgId);
            return {
              uid: p.uid,
              display_name: p.display_name,
              email: p.email,
              role: membership?.role ?? 'viewer',
            };
          });

        setUsers(orgUsers);
      } catch {
        showToast('Failed to load users.', 'error');
      } finally {
        setLoading(false);
      }
    }

    loadUsers();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

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
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? 'Failed to send invitation.';
      showToast(msg, 'error');
    } finally {
      setInviting(false);
    }
  }, [orgId, inviteEmail, inviteRole, showToast]);

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
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
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
