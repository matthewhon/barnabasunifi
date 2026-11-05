'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import {
  getMappings,
  createMapping,
  updateMapping,
  deleteMapping,
  subscribeToDoors,
  subscribeToScheduleWindows,
  syncMappingTimingToScheduleWindows,
  getOrgSettings,
  updateOrgSettings,
  subscribeToAccessPolicyMappings,
  createAccessPolicyMapping,
  updateAccessPolicyMapping,
  deleteAccessPolicyMapping,
  subscribeToSyncedUsers,
  subscribeToAccessPolicies,
  subscribeToUnifiSchedules,
} from '@/lib/firestore';
import type {
  Mapping,
  Door,
  MappingSourceType,
  PcoServiceType,
  PcoGroup,
  ScheduleWindow,
  OrgSettings,
  AccessPolicyMapping,
  SyncedUser,
  UnifiAccessPolicy,
  UnifiSchedule,
  PcoList,
} from '@/lib/types';
import Modal from '@/components/ui/Modal';
import AccessPolicyModal from '@/components/policies/AccessPolicyModal';
import { UnmappedEventsTab } from '@/components/events/UnmappedEventsTab';
import { ActiveMappingCard } from '@/components/mappings/ActiveMappingCard';
import { MappingModal, type MappingModalSavePayload } from '@/components/mappings/MappingModal';
import {
  PeopleListSyncTab,
  AddPolicyMappingModal,
} from '@/components/mappings/PeopleListSyncTab';
import {
  formatIsoTimeRange,
  timeTypeBadgeStyle,
} from '@/components/mappings/ProjectedUnlockTimesPreview';

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function RefreshIcon({ spinning = false }: { spinning?: boolean } = {}) {
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

type MainMappingTab = 'rules' | 'events' | 'people';
type RuleSourceFilter = 'all' | 'service' | 'group';

export default function MappingsPage() {
  const { orgId } = useAuth();

  // Top-level workflow tabs
  const [mainTab, setMainTab] = useState<MainMappingTab>('rules');
  const [ruleSourceFilter, setRuleSourceFilter] = useState<RuleSourceFilter>('all');
  const [eventsSubTab, setEventsSubTab] = useState<'unreviewed' | 'mapped' | 'dismissed' | 'all'>('unreviewed');
  const [resourceFilterTab, setResourceFilterTab] = useState<'unmapped' | 'all'>('unmapped');

  // Data state
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [policyMappings, setPolicyMappings] = useState<AccessPolicyMapping[]>([]);
  const [syncedUsers, setSyncedUsers] = useState<SyncedUser[]>([]);
  const [accessPolicies, setAccessPolicies] = useState<UnifiAccessPolicy[]>([]);
  const [pcoLists, setPcoLists] = useState<PcoList[]>([]);
  const [pcoListsLoading, setPcoListsLoading] = useState(false);

  const [doors, setDoors] = useState<Door[]>([]);
  const [scheduleWindows, setScheduleWindows] = useState<ScheduleWindow[]>([]);
  const [orgSettings, setOrgSettings] = useState<OrgSettings | null>(null);

  // PCO resources (Service Types & Groups)
  const [serviceResources, setServiceResources] = useState<PcoServiceType[]>([]);
  const [groupResources, setGroupResources] = useState<PcoGroup[]>([]);
  const [pcoLoading, setPcoLoading] = useState(false);
  const [pcoError, setPcoError] = useState<string | null>(null);
  const [mappingsLoading, setMappingsLoading] = useState(true);

  // Syncing state
  const [syncingPcoSchedule, setSyncingPcoSchedule] = useState(false);

  // Door mapping create/edit modal state
  const [mappingModalOpen, setMappingModalOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<Mapping | null>(null);
  const [initialEditSection, setInitialEditSection] = useState<'doors' | 'timing'>('doors');
  const [preselectedResource, setPreselectedResource] = useState<{
    sourceType: MappingSourceType;
    resourceId: string;
    resourceLabel: string;
  } | null>(null);
  const [savingMapping, setSavingMapping] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingLabel, setDeletingLabel] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Policy mapping modals & actions
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [savingPolicyMapping, setSavingPolicyMapping] = useState(false);
  const [togglingPolicyId, setTogglingPolicyId] = useState<string | null>(null);

  const [deletePolicyModalOpen, setDeletePolicyModalOpen] = useState(false);
  const [deletingPolicyId, setDeletingPolicyId] = useState<string | null>(null);
  const [deletingPolicyLabel, setDeletingPolicyLabel] = useState('');
  const [deletingPolicy, setDeletingPolicy] = useState(false);

  // Access Policy creation modal
  const [schedules, setSchedules] = useState<UnifiSchedule[]>([]);
  const [accessPolicyModalOpen, setAccessPolicyModalOpen] = useState(false);

  const [syncingUsers, setSyncingUsers] = useState(false);
  const [syncingPolicies, setSyncingPolicies] = useState(false);
  const [enablingSync, setEnablingSync] = useState(false);

  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);

  function showFeedback(text: string, ok: boolean) {
    setFeedback({ text, ok });
    setTimeout(() => setFeedback(null), 4500);
  }

  // Handle URL query parameter for deep-linking (/mappings?tab=...)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get('tab');
      if (tabParam === 'unmapped') {
        setMainTab('events');
        setEventsSubTab('unreviewed');
      } else if (tabParam === 'mapped') {
        setMainTab('events');
        setEventsSubTab('mapped');
      } else if (tabParam === 'events') {
        setMainTab('events');
      } else if (tabParam === 'user_policy' || tabParam === 'people') {
        setMainTab('people');
      } else if (tabParam === 'service') {
        setMainTab('rules');
        setRuleSourceFilter('service');
      } else if (tabParam === 'group') {
        setMainTab('rules');
        setRuleSourceFilter('group');
      }
    }
  }, []);

  // Load initial mappings and org settings
  useEffect(() => {
    if (!orgId) return;
    Promise.all([getMappings(orgId), getOrgSettings(orgId)]).then(([m, s]) => {
      setMappings(m);
      setOrgSettings(s);
      setMappingsLoading(false);
    });
  }, [orgId]);

  // Real-time Firestore subscriptions
  useEffect(() => {
    if (!orgId) return;
    const unsubDoors = subscribeToDoors(orgId, (d) => setDoors(d));
    const unsubWindows = subscribeToScheduleWindows(orgId, (w) => setScheduleWindows(w));
    const unsubPolicyMappings = subscribeToAccessPolicyMappings(orgId, (pm) => setPolicyMappings(pm));
    const unsubSyncedUsers = subscribeToSyncedUsers(orgId, (su) => setSyncedUsers(su));
    const unsubPolicies = subscribeToAccessPolicies(orgId, (ap) => setAccessPolicies(ap));
    const unsubSchedules = subscribeToUnifiSchedules(orgId, (s) => setSchedules(s));

    return () => {
      unsubDoors();
      unsubWindows();
      unsubPolicyMappings();
      unsubSyncedUsers();
      unsubPolicies();
      unsubSchedules();
    };
  }, [orgId]);

  // Fetch both PCO Service Types & Groups so the unified Door Unlock Rules tab has complete data
  const fetchAllPcoResources = useCallback(async () => {
    if (!orgId) return;
    setPcoLoading(true);
    setPcoError(null);
    const getPcoResources = httpsCallable<
      { orgId: string; type: MappingSourceType },
      { items?: Array<PcoServiceType | PcoGroup>; resources?: Array<PcoServiceType | PcoGroup> }
    >(functions, 'getPcoResources');

    try {
      const [srvRes, grpRes] = await Promise.all([
        getPcoResources({ orgId, type: 'service' }),
        getPcoResources({ orgId, type: 'group' }),
      ]);
      setServiceResources((srvRes.data.items ?? srvRes.data.resources ?? []) as PcoServiceType[]);
      setGroupResources((grpRes.data.items ?? grpRes.data.resources ?? []) as PcoGroup[]);
    } catch (err: any) {
      console.error('Failed to load PCO resources:', err);
      setPcoError(err?.message || 'Failed to load Planning Center resources.');
    } finally {
      setPcoLoading(false);
    }
  }, [orgId]);

  const fetchPcoLists = useCallback(async () => {
    if (!orgId) return;
    setPcoListsLoading(true);
    try {
      const getPcoListsFn = httpsCallable<{ orgId: string }, { lists: PcoList[] }>(
        functions,
        'getPcoLists'
      );
      const res = await getPcoListsFn({ orgId });
      setPcoLists(res.data?.lists || []);
    } catch (err: any) {
      console.error('Failed to fetch PCO lists:', err);
    } finally {
      setPcoListsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    fetchAllPcoResources();
    fetchPcoLists();
  }, [orgId, fetchAllPcoResources, fetchPcoLists]);

  // Trigger PCO Schedule Sync
  const handleTriggerPcoScheduleSync = useCallback(async () => {
    if (!orgId) return;
    setSyncingPcoSchedule(true);
    try {
      const triggerFn = httpsCallable<{ orgId: string }, any>(functions, 'triggerPcoSync');
      await triggerFn({ orgId });
      await fetchAllPcoResources();
      showFeedback('Planning Center schedule & events synchronized.', true);
    } catch (err: any) {
      showFeedback(`Schedule sync failed: ${err?.message || 'Check Planning Center connection in Settings.'}`, false);
    } finally {
      setSyncingPcoSchedule(false);
    }
  }, [orgId, fetchAllPcoResources]);

  // Create or Update Mapping
  const handleSaveMappingModal = useCallback(
    async (data: MappingModalSavePayload, existingMappingId?: string) => {
      if (!orgId) return;
      setSavingMapping(true);
      try {
        if (existingMappingId) {
          // Update existing mapping (doors, time_types, and timing rules)
          await updateMapping(orgId, existingMappingId, data);
          const existing = mappings.find((m) => m.id === existingMappingId);
          const updatedMapping: Mapping = {
            ...(existing || {
              id: existingMappingId,
              org_id: orgId,
              created_at: new Date().toISOString(),
            }),
            ...data,
            updated_at: new Date().toISOString(),
          };
          setMappings((prev) =>
            prev.map((m) => (m.id === existingMappingId ? updatedMapping : m))
          );

          await syncMappingTimingToScheduleWindows(
            orgId,
            updatedMapping,
            orgSettings,
            scheduleWindows
          ).catch((err) => console.warn('Failed to immediately sync schedule windows:', err));

          showFeedback(`Updated rule for "${data.pco_resource_label}".`, true);
        } else {
          // Create new mapping
          const id = await createMapping(orgId, data);
          const newMapping: Mapping = {
            id,
            org_id: orgId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...data,
          };
          setMappings((prev) => [...prev, newMapping]);
          showFeedback(`Created door rule for "${data.pco_resource_label}".`, true);
        }

        setMappingModalOpen(false);
        setEditingMapping(null);
        setPreselectedResource(null);

        // Trigger background PCO sync so schedule windows & commands update immediately
        const triggerFn = httpsCallable<{ orgId: string }, any>(functions, 'triggerPcoSync');
        triggerFn({ orgId }).catch((syncErr) =>
          console.warn('Background sync trigger after save mapping failed:', syncErr)
        );
      } catch (err: any) {
        console.error('Failed to save mapping:', err);
        showFeedback(`Failed to save rule: ${err?.message || 'Unknown error'}`, false);
        throw err;
      } finally {
        setSavingMapping(false);
      }
    },
    [orgId, mappings, orgSettings, scheduleWindows]
  );

  const handleToggleMapping = useCallback(
    async (id: string, enabled: boolean) => {
      if (!orgId) return;
      setToggling(id);
      try {
        await updateMapping(orgId, id, { enabled });
        setMappings((prev) => prev.map((m) => (m.id === id ? { ...m, enabled } : m)));
      } catch {
        showFeedback('Failed to update mapping status.', false);
      } finally {
        setToggling(null);
      }
    },
    [orgId]
  );

  function openDeleteModal(id: string, label: string) {
    setDeletingId(id);
    setDeletingLabel(label);
    setDeleteModalOpen(true);
  }

  const handleDeleteConfirm = useCallback(async () => {
    if (!orgId || !deletingId) return;
    setDeleting(true);
    try {
      await deleteMapping(orgId, deletingId);
      setMappings((prev) => prev.filter((m) => m.id !== deletingId));
      setDeleteModalOpen(false);
      showFeedback('Door unlock rule deleted.', true);
    } catch {
      showFeedback('Failed to delete rule.', false);
    } finally {
      setDeleting(false);
    }
  }, [orgId, deletingId]);

  // Policy Mapping Handlers
  const handleSavePolicyMapping = useCallback(
    async (data: {
      pco_list_id: string;
      pco_list_name: string;
      unifi_policy_id: string;
      unifi_policy_name: string;
      enabled: boolean;
    }) => {
      if (!orgId) return;
      setSavingPolicyMapping(true);
      try {
        await createAccessPolicyMapping(orgId, data);
        setPolicyModalOpen(false);
        showFeedback('Access policy list mapping created.', true);
      } catch {
        showFeedback('Failed to create list mapping.', false);
      } finally {
        setSavingPolicyMapping(false);
      }
    },
    [orgId]
  );

  const handleTogglePolicyMapping = useCallback(
    async (id: string, enabled: boolean) => {
      if (!orgId) return;
      setTogglingPolicyId(id);
      try {
        await updateAccessPolicyMapping(orgId, id, { enabled });
        setPolicyMappings((prev) => prev.map((pm) => (pm.id === id ? { ...pm, enabled } : pm)));
      } catch {
        showFeedback('Failed to update list mapping.', false);
      } finally {
        setTogglingPolicyId(null);
      }
    },
    [orgId]
  );

  function openDeletePolicyModal(id: string, label: string) {
    setDeletingPolicyId(id);
    setDeletingPolicyLabel(label);
    setDeletePolicyModalOpen(true);
  }

  const handleDeletePolicyConfirm = useCallback(async () => {
    if (!orgId || !deletingPolicyId) return;
    setDeletingPolicy(true);
    try {
      await deleteAccessPolicyMapping(orgId, deletingPolicyId);
      setDeletePolicyModalOpen(false);
      showFeedback('List mapping deleted.', true);
    } catch {
      showFeedback('Failed to delete list mapping.', false);
    } finally {
      setDeletingPolicy(false);
    }
  }, [orgId, deletingPolicyId]);

  const handleTriggerUserSync = useCallback(async () => {
    if (!orgId) return;
    setSyncingUsers(true);
    try {
      const triggerFn = httpsCallable<{ orgId: string }, any>(functions, 'triggerUserSync');
      const res = await triggerFn({ orgId });
      showFeedback(
        `People Sync completed: ${res.data?.usersCreated ?? 0} created, ${res.data?.usersUpdated ?? 0} updated, ${res.data?.policiesRevoked ?? 0} policies revoked.`,
        true
      );
    } catch (err: any) {
      showFeedback(`People Sync failed: ${err.message}`, false);
    } finally {
      setSyncingUsers(false);
    }
  }, [orgId]);

  const handleSyncPolicies = useCallback(async () => {
    if (!orgId) return;
    setSyncingPolicies(true);
    try {
      const syncFn = httpsCallable<{ orgId: string }, any>(functions, 'syncUnifiAccessPolicies');
      await syncFn({ orgId });
      showFeedback('Access policies sync requested from UniFi.', true);
    } catch (err: any) {
      showFeedback(`Policy sync failed: ${err.message}`, false);
    } finally {
      setSyncingPolicies(false);
    }
  }, [orgId]);

  const handleEnableUserSyncFromBanner = useCallback(async () => {
    if (!orgId) return;
    setEnablingSync(true);
    try {
      await updateOrgSettings(orgId, { enable_user_sync: true });
      setOrgSettings((prev) => (prev ? { ...prev, enable_user_sync: true } : prev));
      showFeedback('People & Access Policy Sync has been enabled.', true);
    } catch {
      showFeedback('Failed to enable people sync.', false);
    } finally {
      setEnablingSync(false);
    }
  }, [orgId]);

  // Derived counts & filtered lists
  const now = new Date();
  const unmappedEventsCount = useMemo(
    () =>
      scheduleWindows.filter((w) => {
        if (w.status === 'cancelled') return false;
        const lockAt = w.lock_at ? new Date(w.lock_at) : null;
        if (lockAt && lockAt < now) return false;
        return (!w.door_ids || w.door_ids.length === 0) && w.review_status !== 'dismissed';
      }).length,
    [scheduleWindows]
  );

  const oneTimeMappedCount = useMemo(
    () =>
      scheduleWindows.filter((w) => {
        if (w.status === 'cancelled') return false;
        const lockAt = w.lock_at ? new Date(w.lock_at) : null;
        if (lockAt && lockAt < now) return false;
        return Boolean(
          w.is_one_time ||
            w.mapping_type === 'one_time' ||
            (w.review_status === 'mapped' &&
              (w.door_ids?.length ?? 0) > 0 &&
              !w.mapping_id &&
              !w.service_mapping_id &&
              !w.group_mapping_id)
        );
      }).length,
    [scheduleWindows]
  );

  const filteredMappings = useMemo(() => {
    if (ruleSourceFilter === 'all') return mappings;
    return mappings.filter((m) => m.source_type === ruleSourceFilter);
  }, [mappings, ruleSourceFilter]);

  const allPcoCatalog = useMemo(() => {
    const srv = serviceResources.map((r) => ({ ...r, sourceType: 'service' as MappingSourceType }));
    const grp = groupResources.map((r) => ({ ...r, sourceType: 'group' as MappingSourceType }));
    const combined = [...srv, ...grp];
    if (ruleSourceFilter === 'service') return srv;
    if (ruleSourceFilter === 'group') return grp;
    return combined;
  }, [serviceResources, groupResources, ruleSourceFilter]);

  const displayedCatalog = useMemo(() => {
    if (resourceFilterTab === 'unmapped') {
      return allPcoCatalog.filter((r) => !mappings.some((m) => m.pco_resource_id === r.id));
    }
    return allPcoCatalog;
  }, [allPcoCatalog, mappings, resourceFilterTab]);

  const unmappedCatalogCount = useMemo(
    () => allPcoCatalog.filter((r) => !mappings.some((m) => m.pco_resource_id === r.id)).length,
    [allPcoCatalog, mappings]
  );

  const isPcoConnected = Boolean(orgSettings?.pco_oauth?.access_token);

  return (
    <div>
      {/* 1. Unified Page Header & Sync Status Bar */}
      <div
        className="page-header"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.25rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
            <h1 className="page-title" style={{ margin: 0 }}>
              Mappings &amp; Sync
            </h1>
            <span
              className={`badge ${isPcoConnected ? 'badge-success' : 'badge-warning'}`}
              style={{ fontSize: '0.7rem' }}
            >
              {isPcoConnected
                ? `✓ PCO Connected${orgSettings?.pco_oauth?.pco_org_name ? ` (${orgSettings.pco_oauth.pco_org_name})` : ''}`
                : '⚠️ PCO Not Connected'}
            </span>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginTop: '0.25rem', marginBottom: 0 }}>
            Automate door unlocks from Planning Center Services &amp; Groups, review one-off events, and sync People Lists to UniFi Access Policies.
          </p>
        </div>

        {/* Context-Aware Primary Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleTriggerPcoScheduleSync}
            disabled={syncingPcoSchedule}
            title="Pull latest service plans and group events from Planning Center"
          >
            <RefreshIcon spinning={syncingPcoSchedule} />
            {syncingPcoSchedule ? 'Syncing PCO…' : 'Sync PCO Schedule'}
          </button>

          {mainTab === 'rules' && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                setEditingMapping(null);
                setPreselectedResource(null);
                setMappingModalOpen(true);
              }}
            >
              <PlusIcon />
              Add Door Rule
            </button>
          )}

          {mainTab === 'people' && (
            <button className="btn btn-primary btn-sm" onClick={() => setPolicyModalOpen(true)}>
              <PlusIcon />
              Map PCO List
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div className={`alert ${feedback.ok ? 'alert-success' : 'alert-danger'}`} style={{ marginBottom: '1.25rem' }}>
          {feedback.text}
        </div>
      )}

      {/* 2. Three Purpose-Driven Workflow Tabs */}
      <div className="tabs" style={{ marginBottom: '1.5rem' }}>
        <button
          className={`tab ${mainTab === 'rules' ? 'active' : ''}`}
          onClick={() => setMainTab('rules')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <span>🚪 Door Unlock Rules</span>
          <span
            className="badge badge-neutral"
            style={{ fontSize: '0.6875rem', padding: '0.05rem 0.45rem', borderRadius: '1rem' }}
          >
            {mappings.length}
          </span>
        </button>

        <button
          className={`tab ${mainTab === 'events' ? 'active' : ''}`}
          onClick={() => setMainTab('events')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <span>📅 Event Review Queue</span>
          {unmappedEventsCount > 0 ? (
            <span
              className="badge badge-warning"
              style={{ fontSize: '0.6875rem', padding: '0.05rem 0.45rem', borderRadius: '1rem', fontWeight: 700 }}
              title={`${unmappedEventsCount} upcoming unmapped events need review`}
            >
              {unmappedEventsCount} Needs Review
            </span>
          ) : oneTimeMappedCount > 0 ? (
            <span
              className="badge badge-success"
              style={{ fontSize: '0.6875rem', padding: '0.05rem 0.45rem', borderRadius: '1rem' }}
            >
              {oneTimeMappedCount} One-Time
            </span>
          ) : null}
        </button>

        <button
          className={`tab ${mainTab === 'people' ? 'active' : ''}`}
          onClick={() => setMainTab('people')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <span>👥 People &amp; List Access</span>
          <span
            className="badge badge-neutral"
            style={{ fontSize: '0.6875rem', padding: '0.05rem 0.45rem', borderRadius: '1rem' }}
          >
            {policyMappings.length}
          </span>
        </button>
      </div>

      {/* ─── TAB 1: DOOR UNLOCK RULES (Services & Groups) ─────────────────── */}
      {mainTab === 'rules' && (
        <div>
          {/* Filter Bar: All vs Services vs Groups + Org Default Info */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            <div style={{ display: 'flex', gap: '0.375rem', background: 'var(--color-bg-surface)', padding: '0.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
              <button
                className={`btn btn-sm ${ruleSourceFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.8125rem', padding: '0.3rem 0.75rem' }}
                onClick={() => setRuleSourceFilter('all')}
              >
                All Rules ({mappings.length})
              </button>
              <button
                className={`btn btn-sm ${ruleSourceFilter === 'service' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.8125rem', padding: '0.3rem 0.75rem' }}
                onClick={() => setRuleSourceFilter('service')}
              >
                ⛪ Services ({mappings.filter((m) => m.source_type === 'service').length})
              </button>
              <button
                className={`btn btn-sm ${ruleSourceFilter === 'group' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.8125rem', padding: '0.3rem 0.75rem' }}
                onClick={() => setRuleSourceFilter('group')}
              >
                👥 Groups ({mappings.filter((m) => m.source_type === 'group').length})
              </button>
            </div>

            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>
                Org Default Timing:{' '}
                <strong style={{ color: 'var(--color-text-secondary)' }}>
                  {orgSettings?.lock_timing_mode === 'after_start' ? '🛡️ Security Mode' : '🕒 Standard Mode'} (-
                  {orgSettings?.unlock_buffer_before_min ?? 15}m / +
                  {orgSettings?.lock_timing_mode === 'after_start'
                    ? (orgSettings?.lock_after_start_min ?? 15)
                    : (orgSettings?.lock_buffer_after_min ?? 15)}
                  m)
                </strong>
              </span>
              <a href="/settings" style={{ color: 'var(--color-accent)', textDecoration: 'none', fontWeight: 500 }}>
                Change
              </a>
            </div>
          </div>

          <div
            className="mappings-split-grid"
            style={{ display: 'grid', gridTemplateColumns: '1.85fr 1.15fr', gap: '1.5rem', alignItems: 'start' }}
          >
            {/* Left Primary Column: Active Door Unlock Rules */}
            <div>
              <div
                style={{
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                  marginBottom: '0.75rem',
                  fontSize: '0.875rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>Active Door Unlock Rules ({filteredMappings.length})</span>
              </div>

              {mappingsLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {[1, 2].map((i) => (
                    <div key={i} className="card skeleton" style={{ height: '9rem', borderRadius: 'var(--radius-lg)' }} />
                  ))}
                </div>
              ) : filteredMappings.length === 0 ? (
                <div className="card empty-state" style={{ padding: '3rem 1.5rem' }}>
                  <p className="empty-state-title">No door unlock rules configured yet</p>
                  <p style={{ fontSize: '0.875rem', maxWidth: '26rem', margin: '0.35rem auto 1rem' }}>
                    Select a Planning Center Service Type or Group from the catalog on the right, or click &quot;Add Door Rule&quot; to automate door unlocks.
                  </p>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setEditingMapping(null);
                      setPreselectedResource(null);
                      setMappingModalOpen(true);
                    }}
                  >
                    <PlusIcon /> Add Door Rule
                  </button>
                </div>
              ) : (
                <div>
                  {filteredMappings.map((m) => {
                    const matchedResource =
                      m.source_type === 'service'
                        ? serviceResources.find((r) => r.id === m.pco_resource_id)
                        : groupResources.find((r) => r.id === m.pco_resource_id);

                    return (
                      <ActiveMappingCard
                        key={m.id}
                        mapping={m}
                        pcoResource={matchedResource}
                        doors={doors}
                        scheduleWindows={scheduleWindows}
                        orgSettings={orgSettings}
                        onToggle={handleToggleMapping}
                        onDelete={openDeleteModal}
                        onEditMapping={(mappingToEdit, section = 'doors') => {
                          setEditingMapping(mappingToEdit);
                          setInitialEditSection(section);
                          setPreselectedResource(null);
                          setMappingModalOpen(true);
                        }}
                        toggling={toggling === m.id}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Column: PCO Catalog with 1-Click "Map Doors" */}
            <div className="card" style={{ padding: '1.25rem', position: 'sticky', top: '4.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>
                  Planning Center Catalog
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${resourceFilterTab === 'unmapped' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ fontSize: '0.725rem', padding: '0.2rem 0.5rem', height: 'auto' }}
                    onClick={() => setResourceFilterTab('unmapped')}
                  >
                    Unmapped ({unmappedCatalogCount})
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${resourceFilterTab === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ fontSize: '0.725rem', padding: '0.2rem 0.5rem', height: 'auto' }}
                    onClick={() => setResourceFilterTab('all')}
                  >
                    All ({allPcoCatalog.length})
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem' }}
                    onClick={fetchAllPcoResources}
                    disabled={pcoLoading}
                    title="Refresh resources from Planning Center"
                  >
                    <RefreshIcon spinning={pcoLoading} />
                  </button>
                </div>
              </div>

              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 0, marginBottom: '0.875rem' }}>
                Click <strong>Map Doors</strong> on any Planning Center Service Type or Group below to create an automated unlock rule.
              </p>

              {pcoLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="skeleton" style={{ height: '4.25rem', borderRadius: 'var(--radius-md)' }} />
                  ))}
                </div>
              ) : pcoError ? (
                <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-md)' }}>
                  <p style={{ color: 'var(--color-danger, #ef4444)', fontSize: '0.8125rem', marginBottom: '0.75rem', fontWeight: 500 }}>
                    {pcoError}
                  </p>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}
                    onClick={fetchAllPcoResources}
                  >
                    Retry
                  </button>
                </div>
              ) : displayedCatalog.length === 0 ? (
                <div className="empty-state" style={{ padding: '1.5rem 0' }}>
                  <p className="empty-state-title" style={{ fontSize: '0.875rem' }}>
                    {resourceFilterTab === 'unmapped'
                      ? 'All PCO resources are mapped! 🎉'
                      : 'No PCO resources found'}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    {resourceFilterTab === 'unmapped'
                      ? 'Switch to "All" to view already-mapped Service Types and Groups.'
                      : 'Ensure Planning Center is connected in Settings.'}
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', maxHeight: '38rem', overflowY: 'auto', paddingRight: '0.15rem' }}>
                  {displayedCatalog.map((r) => {
                    const existingRule = mappings.find((m) => m.pco_resource_id === r.id);
                    const upcomingTimes = r.upcoming_times ?? [];
                    const freq = (r as PcoServiceType).frequency;
                    const sched = (r as PcoGroup).schedule;

                    return (
                      <div
                        key={`${r.sourceType}-${r.id}`}
                        style={{
                          padding: '0.75rem',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--color-bg-elevated)',
                          border: '1px solid var(--color-border)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.45rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--color-text-primary)' }}>
                                {r.name}
                              </span>
                              <span className={`badge ${r.sourceType === 'service' ? 'badge-info' : 'badge-neutral'}`} style={{ fontSize: '0.625rem' }}>
                                {r.sourceType === 'service' ? 'Service' : 'Group'}
                              </span>
                            </div>
                            {(freq || sched) && (
                              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.15rem' }}>
                                <ClockIcon />
                                <span>{freq || sched}</span>
                              </div>
                            )}
                          </div>

                          {existingRule ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', height: 'auto', color: 'var(--color-success)' }}
                              onClick={() => {
                                setEditingMapping(existingRule);
                                setInitialEditSection('doors');
                                setPreselectedResource(null);
                                setMappingModalOpen(true);
                              }}
                            >
                              ✓ Mapped (Edit)
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              style={{ fontSize: '0.725rem', padding: '0.25rem 0.6rem', height: 'auto', whiteSpace: 'nowrap' }}
                              onClick={() => {
                                setEditingMapping(null);
                                setPreselectedResource({
                                  sourceType: r.sourceType,
                                  resourceId: r.id,
                                  resourceLabel: r.name,
                                });
                                setMappingModalOpen(true);
                              }}
                            >
                              Map Doors →
                            </button>
                          )}
                        </div>

                        {upcomingTimes.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                            {upcomingTimes.slice(0, 2).map((t) => {
                              const style = timeTypeBadgeStyle(t.time_type);
                              return (
                                <span
                                  key={t.id}
                                  style={{
                                    fontSize: '0.65rem',
                                    padding: '0.1rem 0.35rem',
                                    borderRadius: 'var(--radius-sm)',
                                    background: style.bg,
                                    color: style.color,
                                    border: `1px solid ${style.border}`,
                                  }}
                                >
                                  {formatIsoTimeRange(t.starts_at, t.ends_at)}
                                </span>
                              );
                            })}
                            {upcomingTimes.length > 2 && (
                              <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', alignSelf: 'center' }}>
                                +{upcomingTimes.length - 2} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB 2: EVENT REVIEW QUEUE (Needs Review & One-Time Mapped) ───── */}
      {mainTab === 'events' && (
        <UnmappedEventsTab defaultTab={eventsSubTab} embedded={true} />
      )}

      {/* ─── TAB 3: PEOPLE & LIST ACCESS (PCO Lists → UniFi Policies) ─────── */}
      {mainTab === 'people' && (
        <PeopleListSyncTab
          orgSettings={orgSettings}
          policyMappings={policyMappings}
          syncedUsers={syncedUsers}
          accessPolicies={accessPolicies}
          pcoListsLoading={pcoListsLoading}
          syncingUsers={syncingUsers}
          syncingPolicies={syncingPolicies}
          enablingSync={enablingSync}
          togglingPolicyId={togglingPolicyId}
          onEnableUserSync={handleEnableUserSyncFromBanner}
          onTriggerUserSync={handleTriggerUserSync}
          onSyncPolicies={handleSyncPolicies}
          onOpenAddListMapping={() => setPolicyModalOpen(true)}
          onOpenCreatePolicy={() => setAccessPolicyModalOpen(true)}
          onRefreshLists={fetchPcoLists}
          onTogglePolicyMapping={handleTogglePolicyMapping}
          onDeletePolicyMapping={openDeletePolicyModal}
        />
      )}

      {/* Unified Create & Edit Mapping Modal */}
      <MappingModal
        isOpen={mappingModalOpen}
        onClose={() => {
          setMappingModalOpen(false);
          setEditingMapping(null);
          setPreselectedResource(null);
        }}
        editingMapping={editingMapping}
        initialEditSection={initialEditSection}
        preselectedResource={preselectedResource}
        defaultSourceType={ruleSourceFilter === 'group' ? 'group' : 'service'}
        serviceResources={serviceResources}
        groupResources={groupResources}
        doors={doors}
        pcoError={pcoError}
        orgSettings={orgSettings}
        onSave={handleSaveMappingModal}
        saving={savingMapping}
      />

      {/* Add Policy Mapping Modal */}
      <AddPolicyMappingModal
        isOpen={policyModalOpen}
        onClose={() => setPolicyModalOpen(false)}
        pcoLists={pcoLists}
        pcoListsLoading={pcoListsLoading}
        accessPolicies={accessPolicies}
        onSave={handleSavePolicyMapping}
        saving={savingPolicyMapping}
        onRefreshPolicies={handleSyncPolicies}
        onRefreshLists={fetchPcoLists}
        onCreateNewPolicy={() => setAccessPolicyModalOpen(true)}
      />

      {/* Access Policy Modal (Create) */}
      <AccessPolicyModal
        isOpen={accessPolicyModalOpen}
        onClose={() => setAccessPolicyModalOpen(false)}
        orgId={orgId || ''}
        policy={null}
        doors={doors}
        schedules={schedules}
        onSaved={() => {
          showFeedback('Access policy saved successfully.', true);
        }}
      />

      {/* Delete Door Mapping Confirmation */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => !deleting && setDeleteModalOpen(false)}
        title="Delete Door Unlock Rule"
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => setDeleteModalOpen(false)} disabled={deleting}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={handleDeleteConfirm} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete Rule'}
            </button>
          </div>
        }
      >
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Are you sure you want to delete the door unlock rule for{' '}
          <strong style={{ color: 'var(--color-text-primary)' }}>{deletingLabel}</strong>?
        </p>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.75rem' }}>
          Existing schedule windows will remain, but no new automated door unlock windows will be created for this resource.
        </p>
      </Modal>

      {/* Delete Policy Mapping Confirmation */}
      <Modal
        isOpen={deletePolicyModalOpen}
        onClose={() => !deletingPolicy && setDeletePolicyModalOpen(false)}
        title="Delete List Mapping"
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => setDeletePolicyModalOpen(false)} disabled={deletingPolicy}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={handleDeletePolicyConfirm} disabled={deletingPolicy}>
              {deletingPolicy ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        }
      >
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Are you sure you want to delete the mapping for list{' '}
          <strong style={{ color: 'var(--color-text-primary)' }}>{deletingPolicyLabel}</strong>?
        </p>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.75rem' }}>
          Deleting this mapping will revoke this access policy from members of this list on the next reconciliation.
        </p>
      </Modal>

      <style>{`
        @media (max-width: 960px) {
          .mappings-split-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
