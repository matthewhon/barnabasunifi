'use client';

import React, { useState } from 'react';
import Modal from '@/components/ui/Modal';
import type {
  AccessPolicyMapping,
  OrgSettings,
  PcoList,
  SyncedUser,
  UnifiAccessPolicy,
} from '@/lib/types';
import { safeFormatDistanceToNow, parseSafeDate } from '@/lib/date-utils';

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ animation: spinning ? 'spin 1s linear infinite' : 'none' }}
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
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

export interface AddPolicyMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  pcoLists: PcoList[];
  pcoListsLoading: boolean;
  accessPolicies: UnifiAccessPolicy[];
  onSave: (data: {
    pco_list_id: string;
    pco_list_name: string;
    unifi_policy_id: string;
    unifi_policy_name: string;
    enabled: boolean;
  }) => Promise<void>;
  saving: boolean;
  onRefreshPolicies?: () => void;
  onRefreshLists?: () => void;
  onCreateNewPolicy?: () => void;
}

export function AddPolicyMappingModal({
  isOpen,
  onClose,
  pcoLists,
  pcoListsLoading,
  accessPolicies,
  onSave,
  saving,
  onRefreshPolicies,
  onRefreshLists,
  onCreateNewPolicy,
}: AddPolicyMappingModalProps) {
  const [selectedListId, setSelectedListId] = useState('');
  const [selectedPolicyId, setSelectedPolicyId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSelectedListId('');
    setSelectedPolicyId('');
    setEnabled(true);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  const selectedList = pcoLists.find((l) => l.id === selectedListId);
  const selectedPolicy = accessPolicies.find((p) => (p.unifi_policy_id || p.id) === selectedPolicyId);

  async function handleSave() {
    setError(null);
    if (!selectedListId) {
      setError('Please select a Planning Center List.');
      return;
    }
    if (!selectedPolicyId) {
      setError('Please select a UniFi Access Policy.');
      return;
    }

    await onSave({
      pco_list_id: selectedListId,
      pco_list_name: selectedList?.name ?? selectedListId,
      unifi_policy_id: selectedPolicyId,
      unifi_policy_name: selectedPolicy?.name ?? selectedPolicyId,
      enabled,
    });
    reset();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Map Planning Center List to UniFi Access Policy"
      footer={
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={handleClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || !selectedListId || !selectedPolicyId}
          >
            {saving ? 'Creating…' : 'Create List Mapping'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {error && (
          <div className="alert alert-danger" style={{ fontSize: '0.8125rem' }}>
            {error}
          </div>
        )}

        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', lineHeight: 1.5, margin: 0 }}>
          Link a Planning Center People List directly to a UniFi Access Policy. Active members in this list will
          automatically receive the chosen access policy, and when they leave the list, the policy is revoked.
        </p>

        {/* 1. Select Planning Center List */}
        <div className="form-group">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
            <label className="form-label" style={{ margin: 0, fontWeight: 600 }}>
              1. Planning Center List
            </label>
            {onRefreshLists && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem' }}
                onClick={onRefreshLists}
                disabled={pcoListsLoading}
              >
                <RefreshIcon spinning={pcoListsLoading} /> Refresh Lists
              </button>
            )}
          </div>

          {pcoListsLoading ? (
            <div className="skeleton" style={{ height: '2.5rem', borderRadius: 'var(--radius-md)' }} />
          ) : (
            <select
              className="form-select"
              value={selectedListId}
              onChange={(e) => setSelectedListId(e.target.value)}
            >
              <option value="">Select a Planning Center List…</option>
              {pcoLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} {l.category ? `(${l.category})` : ''} {l.total_people ? `· ${l.total_people} members` : ''}
                </option>
              ))}
            </select>
          )}
          <span className="form-hint">Only active members from this list will be synchronized.</span>
        </div>

        {/* 2. Select UniFi Access Policy */}
        <div className="form-group">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
            <label className="form-label" style={{ margin: 0, fontWeight: 600 }}>
              2. UniFi Access Policy
            </label>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              {onCreateNewPolicy && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem', color: 'var(--color-primary)' }}
                  onClick={() => {
                    handleClose();
                    onCreateNewPolicy();
                  }}
                >
                  <PlusIcon /> New Policy
                </button>
              )}
              {onRefreshPolicies && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem' }}
                  onClick={onRefreshPolicies}
                >
                  <RefreshIcon /> Sync from UniFi
                </button>
              )}
            </div>
          </div>

          {accessPolicies.length === 0 ? (
            <div
              style={{
                padding: '0.875rem',
                background: 'var(--color-bg-base)',
                border: '1px dashed var(--color-border)',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.8125rem',
                color: 'var(--color-text-secondary)',
              }}
            >
              No access policies discovered from UniFi yet. Ensure your local agent is connected and click &quot;Sync from UniFi&quot; or create a new policy.
            </div>
          ) : (
            <select
              className="form-select"
              value={selectedPolicyId}
              onChange={(e) => setSelectedPolicyId(e.target.value)}
            >
              <option value="">Select a UniFi Access Policy…</option>
              {accessPolicies.map((p) => {
                const polId = p.unifi_policy_id || p.id;
                return (
                  <option key={polId} value={polId}>
                    {p.name} {p.door_ids && p.door_ids.length > 0 ? `(${p.door_ids.length} door(s))` : ''}
                  </option>
                );
              })}
            </select>
          )}
          <span className="form-hint">
            The door schedules and permission rules configured on this policy in UniFi will apply to list members.
          </span>
        </div>

        {/* 3. Enable Mapping */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.875rem 1rem',
            background: 'var(--color-bg-base)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
          }}
        >
          <div>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Enable Mapping Immediately
            </span>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              Automatically include this list in periodic and manual user synchronizations.
            </p>
          </div>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ width: '1.125rem', height: '1.125rem', cursor: 'pointer' }}
          />
        </div>
      </div>
    </Modal>
  );
}

export interface PeopleListSyncTabProps {
  orgSettings: OrgSettings | null;
  policyMappings: AccessPolicyMapping[];
  syncedUsers: SyncedUser[];
  accessPolicies: UnifiAccessPolicy[];
  pcoListsLoading: boolean;
  syncingUsers: boolean;
  syncingPolicies: boolean;
  enablingSync: boolean;
  togglingPolicyId: string | null;
  onEnableUserSync: () => void;
  onTriggerUserSync: () => void;
  onSyncPolicies: () => void;
  onOpenAddListMapping: () => void;
  onOpenCreatePolicy: () => void;
  onRefreshLists: () => void;
  onTogglePolicyMapping: (id: string, enabled: boolean) => void;
  onDeletePolicyMapping: (id: string, label: string) => void;
}

export function PeopleListSyncTab({
  orgSettings,
  policyMappings,
  syncedUsers,
  accessPolicies,
  pcoListsLoading,
  syncingUsers,
  syncingPolicies,
  enablingSync,
  togglingPolicyId,
  onEnableUserSync,
  onTriggerUserSync,
  onSyncPolicies,
  onOpenAddListMapping,
  onOpenCreatePolicy,
  onRefreshLists,
  onTogglePolicyMapping,
  onDeletePolicyMapping,
}: PeopleListSyncTabProps) {
  const [userSearchQuery, setUserSearchQuery] = useState('');

  const filteredUsers = syncedUsers.filter((u) => {
    if (!userSearchQuery) return true;
    const q = userSearchQuery.toLowerCase();
    const nameMatch =
      u.full_name?.toLowerCase().includes(q) || `${u.first_name} ${u.last_name || ''}`.toLowerCase().includes(q);
    const emailMatch = u.email?.toLowerCase().includes(q);
    const listMatch = u.active_list_names?.some((l) => l.toLowerCase().includes(q));
    const policyMatch = u.assigned_policy_names?.some((p) => p.toLowerCase().includes(q));
    return nameMatch || emailMatch || listMatch || policyMatch;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Feature Paused Banner */}
      {!orgSettings?.enable_user_sync && (
        <div
          style={{
            padding: '1rem 1.25rem',
            background: 'rgba(234, 179, 8, 0.1)',
            border: '1px solid rgba(234, 179, 8, 0.3)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontWeight: 600, color: 'var(--color-warning, #ca8a04)', fontSize: '0.9375rem' }}>
              ⚠️ People &amp; Access Policy Sync is Currently Paused
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', marginTop: '0.2rem' }}>
              Enable this feature to automatically provision UniFi users and sync door policies based on your active Planning Center list mappings.
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={onEnableUserSync} disabled={enablingSync}>
            {enablingSync ? 'Enabling…' : 'Enable People Sync'}
          </button>
        </div>
      )}

      {/* Action Bar */}
      <div
        className="card"
        style={{
          padding: '0.875rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--color-text-primary)' }}>
            People &amp; Access Policy Provisioning
          </div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
            Map Planning Center Lists to UniFi Access Policies ({accessPolicies.length} policies available).{' '}
            <a href="/schedule?tab=policies" style={{ color: 'var(--color-accent)', textDecoration: 'none', fontWeight: 500 }}>
              View all policies →
            </a>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onSyncPolicies}
            disabled={syncingPolicies}
            title="Pull latest access policies from UniFi console"
          >
            <RefreshIcon spinning={syncingPolicies} />
            {syncingPolicies ? 'Fetching Policies…' : 'Sync Policies'}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onOpenCreatePolicy}
            title="Create a new UniFi Access Policy"
          >
            <PlusIcon />
            New Policy
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onTriggerUserSync}
            disabled={syncingUsers}
            title="Reconcile Planning Center list members with UniFi Access Users"
          >
            <RefreshIcon spinning={syncingUsers} />
            {syncingUsers ? 'Reconciling…' : 'Sync Users Now'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={onOpenAddListMapping}>
            <PlusIcon />
            Map PCO List
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.9fr', gap: '1.25rem', alignItems: 'start' }}>
        {/* Left: Active List Mappings */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>
              Mapped PCO Lists ({policyMappings.length})
            </span>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
              onClick={onRefreshLists}
              disabled={pcoListsLoading}
              title="Refresh Planning Center lists"
            >
              <RefreshIcon spinning={pcoListsLoading} />
            </button>
          </div>

          {policyMappings.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.5rem 0' }}>
              <p className="empty-state-title" style={{ fontSize: '0.875rem' }}>
                No list mappings configured
              </p>
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
                Connect a Planning Center People List to a UniFi Access Policy to grant automatic badge/PIN access.
              </p>
              <button className="btn btn-primary btn-sm" onClick={onOpenAddListMapping}>
                <PlusIcon /> Map PCO List
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {policyMappings.map((pm) => (
                <div
                  key={pm.id}
                  style={{
                    padding: '0.75rem 0.875rem',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-bg-elevated)',
                    border: '1px solid var(--color-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-text-primary)' }}>
                      {pm.pco_list_name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
                      ➔ Policy: <strong style={{ color: 'var(--color-accent)' }}>{pm.unifi_policy_name}</strong>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label
                      style={{
                        position: 'relative',
                        display: 'inline-block',
                        width: '2.25rem',
                        height: '1.25rem',
                        cursor: togglingPolicyId === pm.id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={pm.enabled}
                        disabled={togglingPolicyId === pm.id}
                        onChange={(e) => onTogglePolicyMapping(pm.id, e.target.checked)}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          backgroundColor: pm.enabled ? 'var(--color-accent)' : 'var(--color-border)',
                          borderRadius: '1.25rem',
                          transition: 'background-color 0.2s',
                        }}
                      >
                        <span
                          style={{
                            position: 'absolute',
                            height: '0.95rem',
                            width: '0.95rem',
                            left: pm.enabled ? '1.15rem' : '0.15rem',
                            bottom: '0.15rem',
                            backgroundColor: 'white',
                            borderRadius: '50%',
                            transition: 'left 0.2s',
                          }}
                        />
                      </span>
                    </label>

                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--color-danger)', padding: '0.2rem' }}
                      onClick={() => onDeletePolicyMapping(pm.id, pm.pco_list_name)}
                      title="Delete list mapping"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Synced Users Table */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>
              Synced People ({syncedUsers.length})
            </span>

            <input
              type="text"
              className="form-input"
              placeholder="Filter by name, email, list, policy…"
              value={userSearchQuery}
              onChange={(e) => setUserSearchQuery(e.target.value)}
              style={{ maxWidth: '16rem', fontSize: '0.8125rem', padding: '0.35rem 0.65rem' }}
            />
          </div>

          {filteredUsers.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem 0' }}>
              <p className="empty-state-title" style={{ fontSize: '0.875rem' }}>
                {syncedUsers.length === 0 ? 'No users synced yet' : 'No users match filter'}
              </p>
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                {syncedUsers.length === 0
                  ? 'Map a PCO list on the left and click "Sync Users Now" to provision access.'
                  : 'Try clearing your search filter.'}
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', fontSize: '0.8125rem' }}>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Contact</th>
                    <th>Active PCO Lists</th>
                    <th>Assigned UniFi Policies</th>
                    <th>Status</th>
                    <th>Last Synced</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => {
                    const hasPolicies = u.assigned_policy_ids && u.assigned_policy_ids.length > 0;
                    return (
                      <tr key={u.id}>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                            {u.full_name || `${u.first_name} ${u.last_name || ''}`.trim()}
                          </div>
                        </td>
                        <td>
                          <div style={{ color: 'var(--color-text-secondary)' }}>{u.email || '—'}</div>
                          {u.phone_number && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{u.phone_number}</div>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                            {u.active_list_names && u.active_list_names.length > 0 ? (
                              u.active_list_names.map((ln, i) => (
                                <span key={i} className="badge badge-info" style={{ fontSize: '0.6875rem' }}>
                                  {ln}
                                </span>
                              ))
                            ) : (
                              <span style={{ color: 'var(--color-text-muted)' }}>None</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                            {u.assigned_policy_names && u.assigned_policy_names.length > 0 ? (
                              u.assigned_policy_names.map((pn, i) => (
                                <span key={i} className="badge badge-success" style={{ fontSize: '0.6875rem' }}>
                                  {pn}
                                </span>
                              ))
                            ) : (
                              <span style={{ color: 'var(--color-text-muted)' }}>None (Revoked)</span>
                            )}
                          </div>
                        </td>
                        <td>
                          {hasPolicies ? (
                            <span className="badge badge-success" style={{ fontSize: '0.6875rem' }}>
                              Active ({u.assigned_policy_ids.length})
                            </span>
                          ) : (
                            <span className="badge badge-neutral" style={{ fontSize: '0.6875rem' }}>
                              No Policy
                            </span>
                          )}
                        </td>
                        <td style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                          {u.last_synced_at ? safeFormatDistanceToNow(parseSafeDate(u.last_synced_at)) : '—'}
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
    </div>
  );
}
