// ─── User & Auth ─────────────────────────────────────────────────────────────

export type UserRole = 'super_admin' | 'org_admin' | 'manager' | 'viewer';

export interface OrgMembership {
  org_id: string;
  role: UserRole;
}

export interface UserProfile {
  uid: string;
  display_name: string;
  email: string;
  photo_url?: string;
  org_memberships: OrgMembership[];
  created_at: string; // ISO8601
}

// Firebase custom claims shape
export interface AuthClaims {
  orgId?: string;
  role?: UserRole;
  agent?: boolean;
}

// ─── Organization ─────────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  pco_connected: boolean; // derived: whether OAuth token exists
}

export interface OrgSettings {
  unlock_buffer_before_min: number; // default 15
  lock_buffer_after_min: number;    // default 15
  poll_interval_min: number;        // default 30
  timezone: string;                 // e.g. "America/Chicago"
  pco_oauth?: {
    access_token: string;
    refresh_token: string;
    expires_at: string; // ISO8601
    pco_org_id?: string;
    pco_org_name?: string;
  };
  unifi_mode?: 'agent' | 'remote';
  unifi_remote?: {
    host: string;
    access_token: string;
  };
  unifi_agent?: {
    host?: string;
    access_token: string;
    skip_tls_verify?: boolean;
    auto_discovered_host?: string;
  };
}

// ─── Mappings ─────────────────────────────────────────────────────────────────

export type MappingSourceType = 'service' | 'group';
export type PlanTimeType = 'service' | 'rehearsal' | 'other';

export interface Mapping {
  id: string;
  org_id: string;
  source_type: MappingSourceType;
  pco_resource_id: string;
  pco_resource_label: string;
  door_ids: string[];
  door_labels: string[];
  /** Only applies to service mappings — which time types trigger unlocks */
  time_types?: PlanTimeType[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Doors ───────────────────────────────────────────────────────────────────

export type DoorState = 'locked' | 'unlocked' | 'unknown';

export interface Door {
  id: string;
  org_id: string;
  unifi_door_id: string;
  label: string;
  current_state: DoorState;
  door_position_status?: 'open' | 'close' | null;
  is_held_unlocked?: boolean;
  hold_unlock_expires_at?: string | null;
  schedule_id?: string | null;
  schedule_name?: string | null;
  unlock_schedule_name?: string | null;
  last_synced: string; // ISO8601
}

// ─── Schedule Windows ─────────────────────────────────────────────────────────

export type ScheduleWindowStatus = 'pending' | 'unlocked' | 'locked' | 'cancelled' | 'error';

export interface ScheduleWindow {
  id: string;
  org_id: string;
  source_type: MappingSourceType;
  source_label: string;       // e.g. "Sunday Morning Service"
  pco_plan_id?: string;
  pco_event_id?: string;
  starts_at: string;          // ISO8601 — original PCO event start
  ends_at: string;            // ISO8601 — original PCO event end
  unlock_at: string;          // starts_at - buffer
  lock_at: string;            // ends_at + buffer
  door_ids: string[];
  door_labels: string[];
  status: ScheduleWindowStatus;
  updated_at: string;
}

// ─── Door Commands ────────────────────────────────────────────────────────────

export type CommandAction =
  | 'unlock'
  | 'lock'
  | 'sync_schedules'
  | 'update_schedule'
  | 'create_schedule'
  | 'delete_schedule'
  | 'sync_visitors'
  | 'create_visitor'
  | 'update_visitor'
  | 'delete_visitor';

export type CommandStatus = 'queued' | 'executing' | 'done' | 'failed' | 'cancelled';

export interface DoorCommand {
  id: string;
  org_id: string;
  door_id?: string;
  unifi_door_id?: string;
  door_label?: string;
  schedule_id?: string;
  schedule_data?: Record<string, unknown>;
  visitor_id?: string;
  visitor_data?: Record<string, unknown>;
  action: CommandAction;
  execute_at: string;         // ISO8601
  duration_min?: number;      // for temporary unlocks
  schedule_window_id?: string;
  status: CommandStatus;
  agent_id?: string;
  claimed_at?: string;
  executed_at?: string;
  result_message?: string;
  triggered_by: 'scheduler' | 'manual';
  actor_uid?: string;
  created_at: string;
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export type AuditAction =
  | 'unlock'
  | 'lock'
  | 'manual_unlock'
  | 'manual_lock'
  | 'pco_sync'
  | 'agent_online'
  | 'agent_offline'
  | 'schedule_created'
  | 'schedule_cancelled'
  | 'schedule_updated'
  | 'schedule_synced'
  | 'schedule_deleted'
  | 'visitor_created'
  | 'visitor_updated'
  | 'visitor_deleted'
  | 'visitor_synced';

export interface AuditLogEntry {
  id: string;
  org_id: string;
  timestamp: string;
  action: AuditAction;
  door_id?: string;
  door_label?: string;
  triggered_by: 'scheduler' | 'manual' | 'agent' | 'system';
  actor_uid?: string;
  actor_label?: string;
  result: 'success' | 'error';
  message?: string;
}

// ─── Agents ───────────────────────────────────────────────────────────────────

export type AgentStatus = 'online' | 'offline' | 'degraded';

export interface Agent {
  id: string;
  org_id: string;
  label: string;
  status: AgentStatus;
  last_heartbeat: string;
  version: string;
  capabilities: string[];
  update_available?: boolean;
  latest_version?: string;
  update_changelog?: string;
  update_status?: 'idle' | 'downloading' | 'applying' | 'restarting' | 'error';
  update_error?: string | null;
  update_approved_version?: string;
  auto_update?: boolean;
}

// ─── PCO API ──────────────────────────────────────────────────────────────────

export interface PcoServiceType {
  id: string;
  name: string;
  frequency?: string;
}

export interface PcoPlanTime {
  id: string;
  plan_id: string;
  service_type_id: string;
  starts_at: string;
  ends_at: string;
  time_type: PlanTimeType;
  name?: string;
}

export interface PcoGroup {
  id: string;
  name: string;
  group_type_id?: string;
  description?: string;
}

export interface PcoGroupEvent {
  id: string;
  group_id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  location?: string;
}

// ─── UniFi API ────────────────────────────────────────────────────────────────

export interface UnifiDoor {
  id: string;
  name: string;
  door_lock_relay_status: 'lock' | 'unlock';
  door_position_status?: 'open' | 'close';
  location_id?: string;
}

export interface UnifiLockRulePayload {
  type: 'custom' | 'lock_early' | 'reset';
  interval?: number; // minutes — for type 'custom'
}

export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface UnifiScheduleTimeSlot {
  start_time: string; // "HH:MM" e.g. "08:00"
  end_time: string;   // "HH:MM" e.g. "17:00"
}

export interface UnifiWeeklyScheduleDay {
  day: DayOfWeek;
  active: boolean;
  slots: UnifiScheduleTimeSlot[];
}

export interface UnifiSchedule {
  id: string;
  org_id: string;
  unifi_schedule_id: string;
  name: string;
  type?: 'unlock' | 'access' | 'custom' | string;
  is_default?: boolean;
  weekly_schedule: UnifiWeeklyScheduleDay[];
  door_ids?: string[];
  door_labels?: string[];
  holiday_group_id?: string;
  raw_data?: Record<string, unknown>;
  last_synced?: string; // ISO8601
  sync_status?: 'synced' | 'pending' | 'error';
  sync_error?: string;
  created_at?: string;
  updated_at?: string;
}

// ─── Visitors ─────────────────────────────────────────────────────────────────

export type VisitorStatus = 'active' | 'upcoming' | 'expired' | 'revoked' | 'pending';

export interface UnifiVisitor {
  id: string;                      // Firestore document ID
  org_id: string;
  unifi_visitor_id?: string;       // ID returned by UniFi Access
  first_name: string;
  last_name?: string;
  full_name?: string;
  mobile_phone?: string;
  email?: string;
  pin_code: string;                // 4-8 digit numeric PIN
  start_time: string;              // ISO8601 string
  end_time: string;                // ISO8601 string
  door_ids: string[];              // UniFi door IDs
  door_labels?: string[];          // Human-readable door names
  status: VisitorStatus;
  purpose?: string;                // e.g. "Contractor", "Guest Speaker"
  sync_status?: 'synced' | 'pending' | 'error';
  sync_error?: string;
  raw_data?: Record<string, unknown>;
  last_synced?: string;            // ISO8601
  created_at?: string;             // ISO8601
  updated_at?: string;             // ISO8601
}

// ─── API Response Wrappers ────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  meta?: {
    total_count?: number;
    count?: number;
    next?: string;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

// ─── Agent Releases (OTA Updates) ─────────────────────────────────────────────

export interface AgentRelease {
  version: string;
  download_url: string;
  changelog: string;
  published_at: string; // ISO8601
  published_by: string;
  file_size_bytes?: number;
}
