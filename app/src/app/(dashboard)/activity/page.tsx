'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  subscribeToAccessLogs,
  subscribeToDoors,
  subscribeToMappings,
  subscribeToScheduleWindows,
  subscribeToAuditLog,
} from '@/lib/firestore';
import type { AccessLogEntry, AccessMethod, Door, Mapping, ScheduleWindow, AuditLogEntry } from '@/lib/types';
import { format, parseISO, isAfter, isBefore, startOfDay, endOfDay } from 'date-fns';
import { safeFormat } from '@/lib/date-utils';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

// ─── Constants & Labels ───────────────────────────────────────────────────────

const METHOD_LABELS: Record<AccessMethod, string> = {
  nfc_card: 'Key Card / Fob',
  pin_code: 'Keypad PIN',
  mobile_tap: 'Mobile Tap',
  hand_wave: 'Hand Wave',
  remote: 'Remote Unlock',
  face: 'Face Recognition',
  visitor_pin: 'Visitor PIN / QR',
  schedule: 'Schedule',
  unknown: 'Unknown Method',
};

const ALL_METHODS: AccessMethod[] = [
  'nfc_card',
  'pin_code',
  'mobile_tap',
  'hand_wave',
  'remote',
  'face',
  'visitor_pin',
  'schedule',
  'unknown',
];

// ─── Icons ────────────────────────────────────────────────────────────────────

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function RefreshIcon({ spin = false }: { spin?: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ animation: spin ? 'spin 1s linear infinite' : 'none' }}
    >
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 7h.01M12 7h.01M17 7h.01M7 12h.01M12 12h.01M17 12h.01M7 17h.01M12 17h.01M17 17h.01" />
    </svg>
  );
}

function MobileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
      <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
      <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  );
}

function RemoteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="10 8 16 12 10 16 10 8" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function UserFaceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function DoorSensorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18" />
      <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
      <circle cx="14" cy="12" r="1" />
    </svg>
  );
}

function ScheduleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <polyline points="12 14 12 17 14 17" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderMethodIcon(method: AccessMethod) {
  switch (method) {
    case 'schedule':
      return <ScheduleIcon />;
    case 'nfc_card':
      return <CardIcon />;
    case 'pin_code':
    case 'visitor_pin':
      return <PinIcon />;
    case 'mobile_tap':
      return <MobileIcon />;
    case 'hand_wave':
      return <WaveIcon />;
    case 'remote':
      return <RemoteIcon />;
    case 'face':
      return <UserFaceIcon />;
    default:
      return <DoorSensorIcon />;
  }
}

function renderResultBadge(result: string, eventType: string) {
  const norm = (result || eventType || '').toLowerCase();
  if (norm.includes('denied') || norm.includes('reject') || norm.includes('fail') || norm.includes('error')) {
    return (
      <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
        {eventType.includes('lock') && !eventType.includes('unlock') ? 'Lock Failed' : 'Access Denied'}
      </span>
    );
  }
  if (eventType === 'door_lock' || norm === 'locked' || (norm.includes('lock') && !norm.includes('unlock'))) {
    return (
      <span
        className="badge"
        style={{
          background: 'rgba(99, 102, 241, 0.12)',
          color: '#6366f1',
          border: '1px solid rgba(99, 102, 241, 0.25)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
          fontWeight: 600,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1' }} />
        Locked
      </span>
    );
  }
  if (norm.includes('success') || norm.includes('access') || norm.includes('granted') || norm.includes('unlock')) {
    return (
      <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
        {norm.includes('unlock') ? 'Unlocked' : 'Access Granted'}
      </span>
    );
  }
  if (norm.includes('open')) {
    return (
      <span className="badge" style={{ background: 'rgba(36, 101, 245, 0.12)', color: '#2465f5', border: '1px solid rgba(36, 101, 245, 0.25)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2465f5' }} />
        Door Opened
      </span>
    );
  }
  if (norm.includes('close')) {
    return (
      <span className="badge badge-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
        Door Closed
      </span>
    );
  }
  return <span className="badge badge-secondary">{result || eventType}</span>;
}

function exportCsv(entries: AccessLogEntry[]) {
  const headers = ['Timestamp', 'Door', 'User / Actor', 'User Type', 'Access Method', 'Event', 'Result', 'Associated Mapping', 'PCO Source', 'Scheduled Unlock Time', 'Scheduled Lock Time', 'Message'];
  const rows = entries.map((e) => [
    e.timestamp,
    e.door_label ?? '',
    e.user_name ?? '',
    e.user_type ?? 'unknown',
    e.access_method_label ?? e.access_method,
    e.event_type,
    e.event_result,
    e.mapping_name ?? '',
    e.source_label ?? '',
    e.window_unlock_at ?? '',
    e.window_lock_at ?? '',
    e.display_message ?? '',
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `access-activity-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── Main Component ───────────────────────────────────────────────────────────

const PAGE_SIZE = 30;

export default function AccessActivityPage() {
  const { orgId } = useAuth();

  const [rawLogs, setRawLogs] = useState<AccessLogEntry[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [doors, setDoors] = useState<Door[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [scheduleWindows, setScheduleWindows] = useState<ScheduleWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);

  // Filters
  const [streamTab, setStreamTab] = useState<'all' | 'schedule' | 'users'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDoor, setSelectedDoor] = useState<string>('all');
  const [methodFilter, setMethodFilter] = useState<AccessMethod | 'all'>('all');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const subscribeLimit = useRef(250);

  const showFeedback = useCallback((text: string, ok: boolean) => {
    setFeedback({ text, ok });
    setTimeout(() => setFeedback(null), 4000);
  }, []);

  // Subscriptions
  useEffect(() => {
    if (!orgId) return;

    const unsubDoors = subscribeToDoors(orgId, (d) => setDoors(d));
    const unsubLogs = subscribeToAccessLogs(
      orgId,
      (entries) => {
        setRawLogs(entries);
        setLoading(false);
      },
      subscribeLimit.current
    );
    const unsubAudit = subscribeToAuditLog(
      orgId,
      (entries) => {
        setAuditEntries(entries);
      },
      250
    );
    const unsubMappings = subscribeToMappings(orgId, (m) => setMappings(m));
    const unsubWindows = subscribeToScheduleWindows(orgId, (w) => setScheduleWindows(w));

    return () => {
      unsubDoors();
      unsubLogs();
      unsubAudit();
      unsubMappings();
      unsubWindows();
    };
  }, [orgId]);

  // Sync Trigger
  const handleSyncNow = async (backfillInput?: boolean | React.MouseEvent) => {
    if (!orgId || syncing) return;
    const backfill = typeof backfillInput === 'boolean' ? backfillInput : false;
    setSyncing(true);
    try {
      const fn = httpsCallable(functions, 'syncUnifiAccessLogs');
      const res: any = await fn({ orgId, backfill, days: backfill ? 90 : 30 });
      const mode = res.data?.mode;
      const count = res.data?.count;
      if (mode === 'remote') {
        showFeedback(`Synced ${count ?? 0} activity log(s) from UniFi Access into permanent Firebase archive.`, true);
      } else {
        showFeedback(
          backfill
            ? 'Full 90-day archive command dispatched to agent. Pulling all available UniFi history into Firebase…'
            : 'Sync command dispatched to local agent.',
          true
        );
      }
    } catch (err: any) {
      showFeedback(err.message || 'Failed to sync activity logs.', false);
    } finally {
      setSyncing(false);
    }
  };

  // Mappings & Windows Lookup Maps
  const mappingsMap = useMemo(() => {
    const map = new Map<string, Mapping>();
    for (const m of mappings) {
      map.set(m.id, m);
      if (m.pco_resource_id) {
        map.set(m.pco_resource_id, m);
      }
    }
    return map;
  }, [mappings]);

  const windowsMap = useMemo(() => {
    const map = new Map<string, ScheduleWindow>();
    for (const w of scheduleWindows) {
      map.set(w.id, w);
    }
    return map;
  }, [scheduleWindows]);

  // Merged Activity Stream (Access Logs + Scheduled Events)
  const allEntries = useMemo(() => {
    // 1. Process access_logs entries and enrich scheduled entries with mapping info & window timestamps
    const enrichedLogs: AccessLogEntry[] = rawLogs.map((entry) => {
      let window = entry.schedule_window_id ? windowsMap.get(entry.schedule_window_id) : undefined;
      const isExplicitScheduled = entry.access_method === 'schedule' || Boolean(entry.schedule_window_id) || entry.user_type === 'scheduler';

      // Match window by door and time if window ID is missing from entry
      if (!window && entry.door_id) {
        const eMs = new Date(entry.timestamp).getTime();
        window = scheduleWindows.find((w) => {
          if (!w.door_ids.includes(entry.door_id)) return false;
          const timing = w.door_timings?.[entry.door_id];
          const uMs = new Date(timing?.unlock_at || w.unlock_at).getTime();
          const lMs = new Date(timing?.lock_at || w.lock_at).getTime();
          return !isNaN(uMs) && !isNaN(lMs) && Math.abs(eMs - uMs) <= 15 * 60 * 1000;
        });
      }

      const isScheduled = isExplicitScheduled || Boolean(window);

      if (isScheduled) {
        const mappingId = entry.mapping_id || window?.mapping_id || window?.service_mapping_id || window?.group_mapping_id;
        const mapping = mappingId ? mappingsMap.get(mappingId) : undefined;

        const mappingName =
          entry.mapping_name ||
          mapping?.pco_resource_label ||
          window?.mapping_name ||
          (window ? window.source_label : undefined);
        const sourceLabel = entry.source_label || window?.source_label;
        const sourceType = entry.source_type || window?.source_type || mapping?.source_type;
        const timeType = entry.time_type || window?.time_type;

        const isLock = entry.event_type === 'door_lock' || (entry.event_type.includes('lock') && !entry.event_type.includes('unlock'));

        const doorTiming = entry.door_id && window?.door_timings ? window.door_timings[entry.door_id] : undefined;
        const windowUnlockAt = entry.window_unlock_at || doorTiming?.unlock_at || window?.unlock_at;
        const windowLockAt = entry.window_lock_at || doorTiming?.lock_at || window?.lock_at;

        return {
          ...entry,
          event_type: isLock ? 'door_lock' : 'door_unlock',
          user_name: entry.user_name || 'Scheduled Automation',
          user_type: 'scheduler' as const,
          access_method: 'schedule' as const,
          access_method_label: entry.access_method_label || (isLock ? 'Scheduled Lock' : 'Scheduled Unlock'),
          mapping_id: mappingId,
          mapping_name: mappingName,
          source_label: sourceLabel,
          source_type: sourceType,
          time_type: timeType,
          window_unlock_at: windowUnlockAt,
          window_lock_at: windowLockAt,
        };
      }
      return entry;
    });

    // 2. Incorporate scheduled lock/unlock entries recorded in audit_log
    const scheduledAuditEntries: AccessLogEntry[] = [];
    for (const a of auditEntries) {
      const actionStr = String(a.action || '');
      const triggeredByStr = String(a.triggered_by || '');
      const isUnlock = actionStr === 'unlock' || actionStr === 'manual_unlock' || actionStr.includes('unlock');
      const isLock = actionStr === 'lock' || actionStr === 'manual_lock' || (actionStr.includes('lock') && !actionStr.includes('unlock'));

      const isScheduled = triggeredByStr === 'scheduler' ||
        triggeredByStr === 'local_scheduler' ||
        Boolean((a as any).schedule_window_id) ||
        Boolean((a as any).window_id) ||
        Boolean((a as any).mapping_id);

      if ((isUnlock || isLock) && isScheduled) {
        const eventType = isUnlock ? 'door_unlock' : 'door_lock';
        const winId = (a as any).schedule_window_id || (a as any).window_id;
        let window = winId ? windowsMap.get(winId) : undefined;
        if (!window && a.door_id) {
          const aTimeMs = new Date(a.timestamp).getTime();
          window = scheduleWindows.find((w) => {
            if (!w.door_ids.includes(a.door_id!)) return false;
            const timing = w.door_timings?.[a.door_id!];
            const uMs = new Date(timing?.unlock_at || w.unlock_at).getTime();
            const lMs = new Date(timing?.lock_at || w.lock_at).getTime();
            return !isNaN(uMs) && !isNaN(lMs) && (Math.abs(aTimeMs - uMs) <= 15 * 60 * 1000 || Math.abs(aTimeMs - lMs) <= 15 * 60 * 1000);
          });
        }

        const mappingId = (a as any).mapping_id || window?.mapping_id || window?.service_mapping_id || window?.group_mapping_id;
        const mapping = mappingId ? mappingsMap.get(mappingId) : undefined;

        const mappingName =
          (a as any).mapping_name ||
          mapping?.pco_resource_label ||
          window?.mapping_name ||
          window?.source_label;
        const sourceLabel = (a as any).source_label || window?.source_label;
        const sourceType = window?.source_type || mapping?.source_type;
        const timeType = window?.time_type;

        const doorTiming = a.door_id && window?.door_timings ? window.door_timings[a.door_id] : undefined;
        const windowUnlockAt = doorTiming?.unlock_at || window?.unlock_at;
        const windowLockAt = doorTiming?.lock_at || window?.lock_at;

        // Dedup: check if an entry with this window_id/door_id/action and close timestamp already exists in enrichedLogs
        const aTimeMs = new Date(a.timestamp).getTime();
        const exists = enrichedLogs.some((e) => {
          if (e.id === a.id || e.id === `audit-${a.id}`) return true;
          if (e.door_id === a.door_id && e.event_type === eventType) {
            const eTimeMs = new Date(e.timestamp).getTime();
            if (Math.abs(eTimeMs - aTimeMs) < 60000) return true;
          }
          return false;
        });

        if (!exists) {
          const doorLabel =
            a.door_label ||
            (a.door_id ? doors.find((d) => d.id === a.door_id || d.unifi_door_id === a.door_id)?.label : undefined) ||
            'Door';
          const actionLabel = isUnlock ? 'unlock' : 'lock';
          const displayMsg =
            a.message ||
            `Scheduled ${actionLabel} for "${doorLabel}" via ${mappingName || 'Schedule'}`;

          scheduledAuditEntries.push({
            id: `audit-${a.id}`,
            org_id: a.org_id || orgId || '',
            timestamp: a.timestamp,
            event_type: eventType,
            event_result: a.result === 'error' ? 'failed' : 'success',
            door_id: a.door_id || '',
            door_label: doorLabel,
            user_id: 'scheduler',
            user_name: 'Scheduled Automation',
            user_type: 'scheduler',
            access_method: 'schedule',
            access_method_label: isUnlock ? 'Scheduled Unlock' : 'Scheduled Lock',
            display_message: displayMsg,
            schedule_window_id: winId,
            mapping_id: mappingId,
            mapping_name: mappingName,
            source_label: sourceLabel,
            source_type: sourceType,
            time_type: timeType,
            window_unlock_at: windowUnlockAt,
            window_lock_at: windowLockAt,
          });
        }
      }
    }

    // 3. Ensure executed / past schedule windows have both unlock and lock representations
    const windowEntries: AccessLogEntry[] = [];
    const nowMs = Date.now();
    for (const w of scheduleWindows) {
      const mapping = (w.mapping_id || w.service_mapping_id || w.group_mapping_id)
        ? mappingsMap.get(w.mapping_id || w.service_mapping_id || w.group_mapping_id!)
        : undefined;
      const mappingName = w.mapping_name || mapping?.pco_resource_label || w.source_label;

      for (let i = 0; i < (w.door_ids || []).length; i++) {
        const doorId = w.door_ids[i];
        const doorObj = doors.find((d) => d.id === doorId || d.unifi_door_id === doorId);
        const doorLabel = w.door_labels?.[i] || doorObj?.label || doorId;
        const timing = w.door_timings?.[doorId];
        const dUnlockAt = timing?.unlock_at || w.unlock_at;
        const dLockAt = timing?.lock_at || w.lock_at;
        const uTimeMs = new Date(dUnlockAt).getTime();
        const lTimeMs = new Date(dLockAt).getTime();

        // 3a. UNLOCK event: If unlock time has arrived or passed
        if (!isNaN(uTimeMs) && uTimeMs <= nowMs) {
          const hasUnlock = [...enrichedLogs, ...scheduledAuditEntries, ...windowEntries].some((e) => {
            if (e.event_type !== 'door_unlock') return false;
            if (e.door_id !== doorId) return false;
            if (e.schedule_window_id === w.id) return true;
            const eMs = new Date(e.timestamp).getTime();
            return Math.abs(eMs - uTimeMs) < 5 * 60 * 1000;
          });

          if (!hasUnlock) {
            windowEntries.push({
              id: `win-unlock-${w.id}-${doorId}`,
              org_id: w.org_id || orgId || '',
              timestamp: dUnlockAt,
              event_type: 'door_unlock',
              event_result: w.status === 'error' ? 'failed' : 'success',
              door_id: doorId,
              door_label: doorLabel,
              user_id: 'scheduler',
              user_name: 'Scheduled Automation',
              user_type: 'scheduler',
              access_method: 'schedule',
              access_method_label: 'Scheduled Unlock',
              display_message: `Scheduled unlock for "${doorLabel}" via ${mappingName}`,
              schedule_window_id: w.id,
              mapping_id: w.mapping_id || w.service_mapping_id || w.group_mapping_id,
              mapping_name: mappingName,
              source_label: w.source_label,
              source_type: w.source_type,
              time_type: w.time_type,
              window_unlock_at: dUnlockAt,
              window_lock_at: dLockAt,
            });
          }
        }

        // 3b. LOCK event: If lock time has arrived or passed
        if (!isNaN(lTimeMs) && lTimeMs <= nowMs) {
          const hasLock = [...enrichedLogs, ...scheduledAuditEntries, ...windowEntries].some((e) => {
            if (e.event_type !== 'door_lock') return false;
            if (e.door_id !== doorId) return false;
            if (e.schedule_window_id === w.id) return true;
            const eMs = new Date(e.timestamp).getTime();
            return Math.abs(eMs - lTimeMs) < 5 * 60 * 1000;
          });

          if (!hasLock) {
            windowEntries.push({
              id: `win-lock-${w.id}-${doorId}`,
              org_id: w.org_id || orgId || '',
              timestamp: dLockAt,
              event_type: 'door_lock',
              event_result: w.status === 'error' ? 'failed' : 'success',
              door_id: doorId,
              door_label: doorLabel,
              user_id: 'scheduler',
              user_name: 'Scheduled Automation',
              user_type: 'scheduler',
              access_method: 'schedule',
              access_method_label: 'Scheduled Lock',
              display_message: `Scheduled lock for "${doorLabel}" via ${mappingName}`,
              schedule_window_id: w.id,
              mapping_id: w.mapping_id || w.service_mapping_id || w.group_mapping_id,
              mapping_name: mappingName,
              source_label: w.source_label,
              source_type: w.source_type,
              time_type: w.time_type,
              window_unlock_at: dUnlockAt,
              window_lock_at: dLockAt,
            });
          }
        }
      }
    }

    const combined = [...enrichedLogs, ...scheduledAuditEntries, ...windowEntries];
    combined.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return combined;
  }, [rawLogs, auditEntries, scheduleWindows, mappingsMap, windowsMap, doors, orgId]);

  // KPI Calculations
  const kpis = useMemo(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    let todayEvents = 0;
    let scheduledEventsCount = 0;
    let scheduledTodayCount = 0;
    let userEventsCount = 0;
    const uniqueUsersToday = new Set<string>();
    const doorCounts: Record<string, number> = {};
    const methodCounts: Record<string, number> = {};

    for (const entry of allEntries) {
      const isSched = entry.access_method === 'schedule' || Boolean(entry.schedule_window_id) || entry.user_type === 'scheduler';
      if (isSched) {
        scheduledEventsCount++;
      } else {
        userEventsCount++;
      }

      if (entry.timestamp && entry.timestamp.startsWith(todayStr)) {
        todayEvents++;
        if (isSched) {
          scheduledTodayCount++;
        }
        if (entry.user_name && !isSched && entry.user_name !== 'Anonymous / Guest' && entry.user_name !== 'Unknown User') {
          uniqueUsersToday.add(entry.user_name);
        }
      }
      if (entry.door_label) {
        doorCounts[entry.door_label] = (doorCounts[entry.door_label] || 0) + 1;
      }
      if (entry.access_method_label) {
        methodCounts[entry.access_method_label] = (methodCounts[entry.access_method_label] || 0) + 1;
      }
    }

    const topDoor = Object.entries(doorCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None';
    const topMethod = Object.entries(methodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'NFC / PIN';

    return {
      total: allEntries.length,
      todayEvents,
      uniqueUsersToday: uniqueUsersToday.size,
      topDoor,
      topMethod,
      scheduledEventsCount,
      scheduledTodayCount,
      userEventsCount,
    };
  }, [allEntries]);

  // Filtered Entries
  const filtered = useMemo(() => {
    return allEntries.filter((e) => {
      // Stream Tab Quick Filter
      const isSched = e.access_method === 'schedule' || Boolean(e.schedule_window_id) || Boolean(e.mapping_id) || e.user_type === 'scheduler';
      if (streamTab === 'schedule' && !isSched) {
        return false;
      }
      if (streamTab === 'users' && isSched) {
        return false;
      }

      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesUser = e.user_name?.toLowerCase().includes(q);
        const matchesDoor = e.door_label?.toLowerCase().includes(q);
        const matchesMethod = e.access_method_label?.toLowerCase().includes(q);
        const matchesMsg = e.display_message?.toLowerCase().includes(q);
        const matchesMapping = e.mapping_name?.toLowerCase().includes(q);
        const matchesSource = e.source_label?.toLowerCase().includes(q);
        if (!matchesUser && !matchesDoor && !matchesMethod && !matchesMsg && !matchesMapping && !matchesSource) {
          return false;
        }
      }

      // Door Filter
      if (selectedDoor !== 'all') {
        if (e.door_id !== selectedDoor && e.door_label !== selectedDoor) return false;
      }

      // Method Filter
      if (methodFilter !== 'all' && e.access_method !== methodFilter) {
        return false;
      }

      // Event Type Filter
      if (eventTypeFilter !== 'all') {
        if (eventTypeFilter === 'opened' && !e.event_type.includes('open')) return false;
        if (eventTypeFilter === 'closed' && !e.event_type.includes('close')) return false;
        if (eventTypeFilter === 'locked') {
          if (!e.event_type.includes('lock') || e.event_type.includes('unlock')) return false;
        }
        if (eventTypeFilter === 'granted') {
          if (e.event_result !== 'success' || (e.event_type.includes('lock') && !e.event_type.includes('unlock'))) return false;
        }
        if (eventTypeFilter === 'denied') {
          if (e.event_result !== 'denied' && e.event_result !== 'failed') return false;
        }
      }

      // Date Range
      if (dateFrom) {
        try {
          if (isBefore(parseISO(e.timestamp), startOfDay(parseISO(dateFrom)))) return false;
        } catch { /* ignore */ }
      }
      if (dateTo) {
        try {
          if (isAfter(parseISO(e.timestamp), endOfDay(parseISO(dateTo)))) return false;
        } catch { /* ignore */ }
      }

      return true;
    });
  }, [allEntries, streamTab, searchQuery, selectedDoor, methodFilter, eventTypeFilter, dateFrom, dateTo]);

  const displayed = filtered.slice(0, displayCount);
  const hasMore = filtered.length > displayCount;

  function handleLoadMore() {
    setDisplayCount((c) => c + PAGE_SIZE);
    if (displayCount + PAGE_SIZE > subscribeLimit.current * 0.8) {
      subscribeLimit.current = subscribeLimit.current + 200;
    }
  }

  function clearFilters() {
    setStreamTab('all');
    setSearchQuery('');
    setSelectedDoor('all');
    setMethodFilter('all');
    setEventTypeFilter('all');
    setDateFrom('');
    setDateTo('');
    setDisplayCount(PAGE_SIZE);
  }

  const hasSearchOrFilterCriteria =
    Boolean(searchQuery) ||
    selectedDoor !== 'all' ||
    methodFilter !== 'all' ||
    eventTypeFilter !== 'all' ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  const hasActiveFilters = hasSearchOrFilterCriteria || streamTab !== 'all';

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* Toast Feedback */}
      {feedback && (
        <div
          style={{
            position: 'fixed',
            bottom: '1.5rem',
            right: '1.5rem',
            zIndex: 100,
            padding: '0.75rem 1.25rem',
            borderRadius: 'var(--radius-md)',
            background: feedback.ok ? 'rgba(16, 185, 129, 0.95)' : 'rgba(239, 68, 68, 0.95)',
            color: '#fff',
            fontWeight: 500,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            backdropFilter: 'blur(4px)',
            transition: 'all var(--transition-fast)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          {feedback.text}
        </div>
      )}

      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: '1.25rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h1 className="page-title" style={{ margin: 0 }}>Activity & Access Stream</h1>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: '#10b981',
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                padding: '0.2rem 0.5rem',
                borderRadius: '9999px',
                letterSpacing: '0.02em',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#10b981',
                  boxShadow: '0 0 6px #10b981',
                  animation: 'pulse 2s infinite',
                }}
              />
              LIVE FEED
            </span>
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Live stream of physical door accesses, credential swipes, and scheduled automated locks & unlocks with Planning Center mappings.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => handleSyncNow(false)}
            disabled={syncing}
            title="Poll UniFi Access API for fresh logs"
          >
            <RefreshIcon spin={syncing} />
            {syncing ? 'Syncing…' : 'Sync Recent'}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => handleSyncNow(true)}
            disabled={syncing}
            title="Deep pull: Fetch up to 90 days of all available historical activity logs from UniFi Access into permanent Firebase storage"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <span>📦</span>
            <span>Archive History (90d)</span>
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => exportCsv(filtered)}
            disabled={filtered.length === 0}
          >
            <DownloadIcon />
            Export CSV
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Events Today
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-primary)', marginTop: '0.25rem' }}>
            {kpis.todayEvents}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            {kpis.total} total recorded
          </div>
        </div>

        <div className="card" style={{ padding: '1rem', borderLeft: '3px solid #6366f1' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Scheduled Automations
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#6366f1', marginTop: '0.25rem' }}>
            {kpis.scheduledEventsCount}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            {kpis.scheduledTodayCount} scheduled today
          </div>
        </div>

        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Unique Users Today
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#2465f5', marginTop: '0.25rem' }}>
            {kpis.uniqueUsersToday}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Active credentials today
          </div>
        </div>

        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Top Access Method
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-primary)', marginTop: '0.5rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {kpis.topMethod}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Primary credential type
          </div>
        </div>

        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Most Active Door
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-primary)', marginTop: '0.5rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {kpis.topDoor}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Highest traffic entrance
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '1rem',
          marginBottom: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        {/* Stream View Mode Tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.75rem' }}>
          <button
            type="button"
            className={`btn btn-sm ${streamTab === 'all' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setStreamTab('all')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: streamTab === 'all' ? 600 : 500 }}
          >
            <span>All Activity</span>
            <span
              style={{
                fontSize: '0.6875rem',
                padding: '0.1rem 0.4rem',
                borderRadius: '999px',
                background: streamTab === 'all' ? 'rgba(255,255,255,0.2)' : 'var(--color-bg-base)',
                border: '1px solid var(--color-border)',
              }}
            >
              {allEntries.length}
            </span>
          </button>

          <button
            type="button"
            className={`btn btn-sm ${streamTab === 'schedule' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setStreamTab('schedule')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontWeight: streamTab === 'schedule' ? 600 : 500,
              background: streamTab === 'schedule' ? '#6366f1' : undefined,
              borderColor: streamTab === 'schedule' ? '#6366f1' : undefined,
              color: streamTab === 'schedule' ? '#ffffff' : undefined,
            }}
          >
            <ScheduleIcon />
            <span>Scheduled Lock & Unlock</span>
            <span
              style={{
                fontSize: '0.6875rem',
                padding: '0.1rem 0.4rem',
                borderRadius: '999px',
                background: streamTab === 'schedule' ? 'rgba(255,255,255,0.2)' : 'rgba(99, 102, 241, 0.1)',
                color: streamTab === 'schedule' ? '#ffffff' : '#6366f1',
                border: streamTab === 'schedule' ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(99, 102, 241, 0.25)',
                fontWeight: 700,
              }}
            >
              {kpis.scheduledEventsCount}
            </span>
          </button>

          <button
            type="button"
            className={`btn btn-sm ${streamTab === 'users' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setStreamTab('users')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: streamTab === 'users' ? 600 : 500 }}
          >
            <span>👤 User & Badge Activity</span>
            <span
              style={{
                fontSize: '0.6875rem',
                padding: '0.1rem 0.4rem',
                borderRadius: '999px',
                background: streamTab === 'users' ? 'rgba(255,255,255,0.2)' : 'var(--color-bg-base)',
                border: '1px solid var(--color-border)',
              }}
            >
              {kpis.userEventsCount}
            </span>
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
          {/* Search Box */}
          <div className="form-group" style={{ flex: '3 1 14rem' }}>
            <label className="form-label">Search Mapping, Event, User, or Door</label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Search by mapping name, PCO series, door, or actor…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: '2.25rem' }}
              />
              <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>
                <SearchIcon />
              </span>
            </div>
          </div>

          {/* Door Filter */}
          <div className="form-group" style={{ flex: '2 1 11rem' }}>
            <label className="form-label">Door</label>
            <select
              className="form-select"
              value={selectedDoor}
              onChange={(e) => setSelectedDoor(e.target.value)}
            >
              <option value="all">All Doors</option>
              {doors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label || d.id}
                </option>
              ))}
            </select>
          </div>

          {/* Method Filter */}
          <div className="form-group" style={{ flex: '2 1 11rem' }}>
            <label className="form-label">Access Method</label>
            <select
              className="form-select"
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as AccessMethod | 'all')}
            >
              <option value="all">All Methods</option>
              {ALL_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m === 'schedule' ? '📅 Schedule (Automated)' : METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>

          {/* Event Type Filter */}
          <div className="form-group" style={{ flex: '1.5 1 9rem' }}>
            <label className="form-label">Event Result</label>
            <select
              className="form-select"
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value)}
            >
              <option value="all">All Results</option>
              <option value="granted">Access Granted / Unlocked</option>
              <option value="locked">Door Locked</option>
              <option value="denied">Access Denied / Failed</option>
              <option value="opened">Door Opened</option>
              <option value="closed">Door Closed</option>
            </select>
          </div>
        </div>

        {/* Date Filters & Clear */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end', paddingTop: '0.25rem' }}>
          <div className="form-group" style={{ flex: '1 1 9rem' }}>
            <label className="form-label">From</label>
            <input
              type="date"
              className="form-input"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="form-group" style={{ flex: '1 1 9rem' }}>
            <label className="form-label">To</label>
            <input
              type="date"
              className="form-input"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          {hasActiveFilters && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={clearFilters}
              style={{ alignSelf: 'flex-end', height: '2.375rem', marginBottom: '0.25rem' }}
            >
              Clear Filters
            </button>
          )}

          <div style={{ marginLeft: 'auto', fontSize: '0.8125rem', color: 'var(--color-text-muted)', alignSelf: 'center' }}>
            Showing {displayed.length} of {filtered.length} entries
          </div>
        </div>
      </div>

      {/* Access Activity Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <div
              style={{
                width: '2rem',
                height: '2rem',
                border: '3px solid var(--color-border)',
                borderTopColor: 'var(--color-accent)',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                margin: '0 auto 1rem',
              }}
            />
            Loading activity stream…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '3.5rem 1rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>
              {streamTab === 'schedule' ? '📅' : '🚪'}
            </div>
            <h3 style={{ margin: '0 0 0.5rem', color: 'var(--color-text-primary)' }}>
              {hasSearchOrFilterCriteria
                ? 'No matching activity'
                : streamTab === 'schedule'
                ? 'No scheduled door locks or unlocks recorded yet'
                : 'No door activity recorded yet'}
            </h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', maxWidth: '440px', margin: '0 auto 1.5rem' }}>
              {hasSearchOrFilterCriteria
                ? 'Try adjusting your search criteria or date filters.'
                : streamTab === 'schedule'
                ? 'As Planning Center events reach their configured unlock and lock buffer times, automated executions and their associated door mappings will stream here live.'
                : 'As users tap cards, enter PINs, use mobile keys, or scheduled mappings trigger, their events will stream here live.'}
            </p>
            {hasActiveFilters ? (
              <button className="btn btn-secondary btn-sm" onClick={clearFilters}>
                Clear All Filters
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={handleSyncNow} disabled={syncing}>
                <RefreshIcon spin={syncing} />
                Sync Recent Logs from UniFi
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ width: '160px' }}>Timestamp</th>
                  <th style={{ width: '200px' }}>Actor / Trigger</th>
                  <th>Door</th>
                  <th>Access Method</th>
                  <th>Event / Result</th>
                  <th>Activity & Mapping Details</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((entry) => {
                  const isScheduled = entry.access_method === 'schedule' || Boolean(entry.schedule_window_id) || entry.user_type === 'scheduler';
                  const isLock = entry.event_type === 'door_lock' || (entry.event_type.includes('lock') && !entry.event_type.includes('unlock'));

                  return (
                    <tr
                      key={entry.id}
                      style={{
                        background: isScheduled ? 'rgba(99, 102, 241, 0.02)' : undefined,
                      }}
                    >
                      {/* Timestamp */}
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.8125rem' }}>
                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                          {safeFormat(entry.timestamp, 'h:mm:ss a')}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          {safeFormat(entry.timestamp, 'MMM d, yyyy')}
                        </div>
                        {isScheduled && isLock && entry.window_unlock_at && (
                          <div
                            style={{
                              fontSize: '0.6875rem',
                              color: 'var(--color-success, #10b981)',
                              fontWeight: 600,
                              marginTop: '0.25rem',
                            }}
                            title={`Door was scheduled to unlock at ${safeFormat(entry.window_unlock_at, 'h:mm:ss a')}`}
                          >
                            🔓 Unlocked: {safeFormat(entry.window_unlock_at, 'h:mm a')}
                          </div>
                        )}
                        {isScheduled && !isLock && entry.window_lock_at && (
                          <div
                            style={{
                              fontSize: '0.6875rem',
                              color: '#d97706',
                              fontWeight: 600,
                              marginTop: '0.25rem',
                            }}
                            title={`Door is scheduled to lock at ${safeFormat(entry.window_lock_at, 'h:mm:ss a')}`}
                          >
                            🔒 Locks: {safeFormat(entry.window_lock_at, 'h:mm a')}
                          </div>
                        )}
                      </td>

                      {/* User / Actor */}
                      <td>
                        {isScheduled ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div
                              style={{
                                width: '1.875rem',
                                height: '1.875rem',
                                borderRadius: 'var(--radius-sm, 6px)',
                                background: 'rgba(99, 102, 241, 0.12)',
                                color: '#6366f1',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.875rem',
                                flexShrink: 0,
                                border: '1px solid rgba(99, 102, 241, 0.25)',
                              }}
                            >
                              <ScheduleIcon />
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>
                                Scheduled Automation
                              </div>
                              <span
                                style={{
                                  fontSize: '0.6875rem',
                                  color: '#6366f1',
                                  fontWeight: 600,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.04em',
                                }}
                              >
                                PCO Scheduler
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div
                              style={{
                                width: '1.75rem',
                                height: '1.75rem',
                                borderRadius: '50%',
                                background: entry.user_type === 'visitor' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(36, 101, 245, 0.15)',
                                color: entry.user_type === 'visitor' ? '#d97706' : '#2465f5',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {(entry.user_name || 'U')[0].toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>
                                {entry.user_name || 'Anonymous / Sensor'}
                              </div>
                              {entry.user_type && entry.user_type !== 'unknown' && (
                                <span
                                  style={{
                                    fontSize: '0.6875rem',
                                    color: entry.user_type === 'visitor' ? '#d97706' : 'var(--color-text-muted)',
                                    textTransform: 'capitalize',
                                  }}
                                >
                                  {entry.user_type}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Door */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                          <DoorSensorIcon />
                          {entry.door_label || 'Unspecified Door'}
                        </div>
                      </td>

                      {/* Access Method */}
                      <td>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.375rem',
                            padding: '0.25rem 0.625rem',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '0.8125rem',
                            background: isScheduled ? 'rgba(99, 102, 241, 0.08)' : 'var(--color-bg-base)',
                            border: isScheduled ? '1px solid rgba(99, 102, 241, 0.25)' : '1px solid var(--color-border)',
                            color: isScheduled ? '#6366f1' : 'var(--color-text-primary)',
                            fontWeight: isScheduled ? 600 : 500,
                          }}
                        >
                          {renderMethodIcon(entry.access_method)}
                          {isScheduled
                            ? isLock
                              ? 'Scheduled Lock'
                              : 'Scheduled Unlock'
                            : entry.access_method_label || METHOD_LABELS[entry.access_method] || 'Unknown'}
                        </span>
                      </td>

                      {/* Event & Result */}
                      <td>
                        {renderResultBadge(entry.event_result, entry.event_type)}
                      </td>

                      {/* Activity Details / Message & Mappings */}
                      <td style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', maxWidth: '360px' }}>
                        {isScheduled ? (
                          <div>
                            {/* Associated Mapping Pill */}
                            {entry.mapping_name ? (
                              <div style={{ marginBottom: '0.35rem' }}>
                                <a
                                  href="/mappings"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.3rem',
                                    padding: '0.2rem 0.5rem',
                                    borderRadius: '4px',
                                    background: 'rgba(36, 101, 245, 0.08)',
                                    border: '1px solid rgba(36, 101, 245, 0.25)',
                                    color: '#2465f5',
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    textDecoration: 'none',
                                  }}
                                  title="View Mapping in Mappings & Sync"
                                >
                                  <LinkIcon />
                                  <span>Mapping: {entry.mapping_name}</span>
                                </a>
                              </div>
                            ) : (
                              <div style={{ marginBottom: '0.35rem' }}>
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.3rem',
                                    padding: '0.2rem 0.5rem',
                                    borderRadius: '4px',
                                    background: 'var(--color-bg-base)',
                                    border: '1px solid var(--color-border)',
                                    color: 'var(--color-text-secondary)',
                                    fontSize: '0.75rem',
                                    fontWeight: 500,
                                  }}
                                >
                                  <LinkIcon />
                                  <span>PCO Scheduled Event</span>
                                </span>
                              </div>
                            )}

                            {/* PCO Source & Time Type */}
                            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.2rem' }}>
                              {entry.source_label && (
                                <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                  {entry.source_label}
                                </span>
                              )}
                              {entry.time_type && (
                                <span
                                  className="badge"
                                  style={{
                                    fontSize: '0.6875rem',
                                    padding: '0.1rem 0.35rem',
                                    background: entry.time_type === 'rehearsal' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(36, 101, 245, 0.12)',
                                    color: entry.time_type === 'rehearsal' ? '#d97706' : '#2465f5',
                                    textTransform: 'capitalize',
                                    fontWeight: 600,
                                  }}
                                >
                                  {entry.time_type}
                                </span>
                              )}
                            </div>

                            {/* Scheduled Window Time Range */}
                            {(entry.window_unlock_at || entry.window_lock_at) && (
                              <div
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.4rem',
                                  padding: '0.2rem 0.5rem',
                                  borderRadius: 'var(--radius-sm, 4px)',
                                  background: 'rgba(16, 185, 129, 0.08)',
                                  border: '1px solid rgba(16, 185, 129, 0.25)',
                                  fontSize: '0.75rem',
                                  marginTop: '0.35rem',
                                  flexWrap: 'wrap',
                                }}
                              >
                                <ClockIcon />
                                <span>
                                  <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>Scheduled Window:</span>{' '}
                                  {entry.window_unlock_at && (
                                    <span style={{ color: 'var(--color-success, #10b981)', fontWeight: 700 }}>
                                      🔓 Unlock: {safeFormat(entry.window_unlock_at, 'h:mm a')}
                                    </span>
                                  )}
                                  {entry.window_unlock_at && entry.window_lock_at && <span> → </span>}
                                  {entry.window_lock_at && (
                                    <span style={{ color: '#d97706', fontWeight: 700 }}>
                                      🔒 Lock: {safeFormat(entry.window_lock_at, 'h:mm a')}
                                    </span>
                                  )}
                                </span>
                              </div>
                            )}

                            {/* Detailed description */}
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                              {entry.display_message}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div>{entry.display_message || `${entry.event_type} (${entry.event_result})`}</div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Load More Footer */}
        {hasMore && (
          <div style={{ padding: '1rem', textAlign: 'center', borderTop: '1px solid var(--color-border)' }}>
            <button className="btn btn-secondary btn-sm" onClick={handleLoadMore}>
              Load More Activity
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.95); }
        }
      `}</style>
    </div>
  );
}
