import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Unsubscribe,
  QueryConstraint,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type {
  Organization,
  OrgSettings,
  Mapping,
  Door,
  ScheduleWindow,
  DoorCommand,
  AuditLogEntry,
  Agent,
  UnifiSchedule,
  UnifiVisitor,
} from '@/lib/types';

// ─── Organizations ───────────────────────────────────────────────────────────

export async function getOrganization(orgId: string): Promise<Organization | null> {
  const snap = await getDoc(doc(db, 'organizations', orgId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Organization) : null;
}

export async function getOrgSettings(orgId: string): Promise<OrgSettings | null> {
  const snap = await getDoc(doc(db, 'organizations', orgId, 'settings', 'config'));
  return snap.exists() ? (snap.data() as OrgSettings) : null;
}

export async function updateOrgSettings(
  orgId: string,
  settings: Partial<OrgSettings>,
): Promise<void> {
  await setDoc(
    doc(db, 'organizations', orgId, 'settings', 'config'),
    { ...settings, updated_at: serverTimestamp() },
    { merge: true },
  );
}

// ─── Mappings ─────────────────────────────────────────────────────────────────

export async function getMappings(orgId: string): Promise<Mapping[]> {
  const snap = await getDocs(collection(db, 'organizations', orgId, 'mappings'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Mapping));
}

export async function createMapping(
  orgId: string,
  mapping: Omit<Mapping, 'id' | 'org_id' | 'created_at' | 'updated_at'>,
): Promise<string> {
  const ref = await addDoc(collection(db, 'organizations', orgId, 'mappings'), {
    ...mapping,
    org_id: orgId,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
  return ref.id;
}

export async function updateMapping(
  orgId: string,
  mappingId: string,
  updates: Partial<Mapping>,
): Promise<void> {
  await updateDoc(doc(db, 'organizations', orgId, 'mappings', mappingId), {
    ...updates,
    updated_at: serverTimestamp(),
  });
}

export async function deleteMapping(orgId: string, mappingId: string): Promise<void> {
  await deleteDoc(doc(db, 'organizations', orgId, 'mappings', mappingId));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeTimestamp(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (val as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  if (typeof val === 'object' && val !== null && 'seconds' in val) {
    return new Date((val as { seconds: number }).seconds * 1000).toISOString();
  }
  const d = new Date(val as string | number);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// ─── Doors ───────────────────────────────────────────────────────────────────

export async function getDoors(orgId: string): Promise<Door[]> {
  const snap = await getDocs(collection(db, 'organizations', orgId, 'doors'));
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      last_synced: data.last_synced ? normalizeTimestamp(data.last_synced) : undefined,
    } as unknown as Door;
  });
}

export function subscribeToDoors(orgId: string, callback: (doors: Door[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'organizations', orgId, 'doors'), (snap) => {
    callback(snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        last_synced: data.last_synced ? normalizeTimestamp(data.last_synced) : undefined,
      } as unknown as Door;
    }));
  });
}

// ─── Schedule Windows ─────────────────────────────────────────────────────────

export function subscribeToScheduleWindows(
  orgId: string,
  callback: (windows: ScheduleWindow[]) => void,
  filters?: { status?: string },
): Unsubscribe {
  const constraints: QueryConstraint[] = [orderBy('unlock_at', 'asc')];
  if (filters?.status) {
    constraints.unshift(where('status', '==', filters.status));
  }
  const q = query(
    collection(db, 'organizations', orgId, 'schedule_windows'),
    ...constraints,
  );
  return onSnapshot(q, (snap) => {
    const windows = snap.docs.map((d) => {
      const data = d.data();

      return {
        id: d.id,
        ...data,
        starts_at: normalizeTimestamp(data.starts_at),
        ends_at: normalizeTimestamp(data.ends_at),
        unlock_at: normalizeTimestamp(data.unlock_at),
        lock_at: normalizeTimestamp(data.lock_at),
        source_type: data.source_type ?? (data.source === 'pco_group' ? 'group' : 'service'),
        source_label: data.source_label ?? data.label ?? 'PCO Event',
        door_ids: data.door_ids ?? [],
        door_labels: data.door_labels ?? [],
        status: data.status ?? 'pending',
      } as unknown as ScheduleWindow;
    });
    callback(windows);
  });
}

// ─── Door Commands ────────────────────────────────────────────────────────────

export async function createDoorCommand(
  orgId: string,
  command: Omit<DoorCommand, 'id' | 'created_at'>,
): Promise<string> {
  const ref = await addDoc(collection(db, 'organizations', orgId, 'door_commands'), {
    ...command,
    created_at: serverTimestamp(),
  });
  return ref.id;
}

export function subscribeToRecentCommands(
  orgId: string,
  callback: (commands: DoorCommand[]) => void,
  count = 20,
): Unsubscribe {
  const q = query(
    collection(db, 'organizations', orgId, 'door_commands'),
    orderBy('created_at', 'desc'),
    limit(count),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as unknown as DoorCommand)));
  });
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export function subscribeToAuditLog(
  orgId: string,
  callback: (entries: AuditLogEntry[]) => void,
  count = 50,
): Unsubscribe {
  const q = query(
    collection(db, 'organizations', orgId, 'audit_log'),
    orderBy('timestamp', 'desc'),
    limit(count),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => {
      const data = d.data();
      const isManual = data.triggered_by === 'manual' || (!data.schedule_window_id && (data.action === 'manual_unlock' || data.action === 'manual_lock' || data.action === 'unlock' || data.action === 'lock'));
      let action = data.action;
      if (action === 'unlock' && isManual) action = 'manual_unlock';
      if (action === 'lock' && isManual) action = 'manual_lock';

      return {
        id: d.id,
        ...data,
        action,
        triggered_by: data.triggered_by || (isManual ? 'manual' : 'scheduler'),
        result: data.result || (data.status === 'done' ? 'success' : data.status === 'failed' ? 'error' : 'success'),
        message: data.message || data.result_message,
        door_label: data.door_label || data.door_name || (data.unifi_door_id ? `Door (${data.unifi_door_id.slice(0, 8)})` : undefined),
        timestamp: normalizeTimestamp(data.timestamp || data.executed_at || data.created_at),
      } as unknown as AuditLogEntry;
    }));
  });
}

// ─── Agents ───────────────────────────────────────────────────────────────────

export function subscribeToAgents(
  orgId: string,
  callback: (agents: Agent[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'agents'),
    where('org_id', '==', orgId),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        registered_at: data.registered_at ? normalizeTimestamp(data.registered_at) : undefined,
        last_heartbeat: data.last_heartbeat ? normalizeTimestamp(data.last_heartbeat) : undefined,
      } as unknown as Agent;
    }));
  });
}

export async function approveAgentUpdate(
  agentId: string,
  targetVersion: string,
  orgId?: string
): Promise<void> {
  const agentRef = doc(db, 'agents', agentId);
  await updateDoc(agentRef, {
    update_approved_version: targetVersion,
    update_status: 'downloading',
  });

  if (orgId) {
    try {
      await addDoc(collection(db, 'organizations', orgId, 'door_commands'), {
        agent_id: agentId,
        door_id: 'agent',
        action: 'apply_update',
        target_version: targetVersion,
        created_at: serverTimestamp(),
        status: 'pending',
      });
    } catch {
      // Non-critical redundancy
    }
  }
}

export async function setAgentAutoUpdate(
  agentId: string,
  autoUpdate: boolean
): Promise<void> {
  const agentRef = doc(db, 'agents', agentId);
  await updateDoc(agentRef, {
    auto_update: autoUpdate,
  });
}

// ─── Super Admin ──────────────────────────────────────────────────────────────

export async function getAllOrganizations(): Promise<Organization[]> {
  const snap = await getDocs(collection(db, 'organizations'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Organization));
}

// ─── UniFi Schedules ─────────────────────────────────────────────────────────

export async function getUnifiSchedules(orgId: string): Promise<UnifiSchedule[]> {
  const snap = await getDocs(collection(db, 'organizations', orgId, 'unifi_schedules'));
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      last_synced: data.last_synced ? normalizeTimestamp(data.last_synced) : undefined,
      updated_at: data.updated_at ? normalizeTimestamp(data.updated_at) : undefined,
    } as unknown as UnifiSchedule;
  });
}

export function subscribeToUnifiSchedules(
  orgId: string,
  callback: (schedules: UnifiSchedule[]) => void,
): Unsubscribe {
  const q = collection(db, 'organizations', orgId, 'unifi_schedules');
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        last_synced: data.last_synced ? normalizeTimestamp(data.last_synced) : undefined,
        updated_at: data.updated_at ? normalizeTimestamp(data.updated_at) : undefined,
      } as unknown as UnifiSchedule;
    }));
  });
}

// ─── UniFi Visitors ──────────────────────────────────────────────────────────

export async function getVisitors(orgId: string): Promise<UnifiVisitor[]> {
  const snap = await getDocs(collection(db, 'organizations', orgId, 'visitors'));
  const now = Date.now();
  return snap.docs.map((d) => {
    const data = d.data();
    const startTimeIso = normalizeTimestamp(data.start_time);
    const endTimeIso = normalizeTimestamp(data.end_time);
    let status = data.status || 'active';
    if (status !== 'revoked') {
      const startMs = new Date(startTimeIso).getTime();
      const endMs = new Date(endTimeIso).getTime();
      if (now < startMs) {
        status = 'upcoming';
      } else if (now >= endMs) {
        status = 'expired';
      } else {
        status = 'active';
      }
    }
    return {
      id: d.id,
      ...data,
      start_time: startTimeIso,
      end_time: endTimeIso,
      status,
      last_synced: data.last_synced ? normalizeTimestamp(data.last_synced) : undefined,
      updated_at: data.updated_at ? normalizeTimestamp(data.updated_at) : undefined,
    } as unknown as UnifiVisitor;
  });
}

export function subscribeToVisitors(
  orgId: string,
  callback: (visitors: UnifiVisitor[]) => void,
): Unsubscribe {
  const q = collection(db, 'organizations', orgId, 'visitors');
  return onSnapshot(q, (snap) => {
    const now = Date.now();
    callback(snap.docs.map((d) => {
      const data = d.data();
      const startTimeIso = normalizeTimestamp(data.start_time);
      const endTimeIso = normalizeTimestamp(data.end_time);
      let status = data.status || 'active';
      if (status !== 'revoked') {
        const startMs = new Date(startTimeIso).getTime();
        const endMs = new Date(endTimeIso).getTime();
        if (now < startMs) {
          status = 'upcoming';
        } else if (now >= endMs) {
          status = 'expired';
        } else {
          status = 'active';
        }
      }
      return {
        id: d.id,
        ...data,
        start_time: startTimeIso,
        end_time: endTimeIso,
        status,
        last_synced: data.last_synced ? normalizeTimestamp(data.last_synced) : undefined,
        updated_at: data.updated_at ? normalizeTimestamp(data.updated_at) : undefined,
      } as unknown as UnifiVisitor;
    }));
  });
}

// ─── Agent Releases ──────────────────────────────────────────────────────────

export async function getLatestAgentRelease(): Promise<import('@/lib/types').AgentRelease | null> {
  const snap = await getDoc(doc(db, 'agent_releases', 'latest'));
  return snap.exists() ? (snap.data() as import('@/lib/types').AgentRelease) : null;
}

