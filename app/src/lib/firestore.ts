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

// ─── Doors ───────────────────────────────────────────────────────────────────

export async function getDoors(orgId: string): Promise<Door[]> {
  const snap = await getDocs(collection(db, 'organizations', orgId, 'doors'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Door));
}

export function subscribeToDoors(orgId: string, callback: (doors: Door[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'organizations', orgId, 'doors'), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Door)));
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
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ScheduleWindow)));
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
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DoorCommand)));
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
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuditLogEntry)));
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
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Agent)));
  });
}

// ─── Super Admin ──────────────────────────────────────────────────────────────

export async function getAllOrganizations(): Promise<Organization[]> {
  const snap = await getDocs(collection(db, 'organizations'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Organization));
}
