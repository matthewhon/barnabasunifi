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

export type LockTimingMode = 'after_end' | 'after_start';

export interface OrgSettings {
  unlock_buffer_before_min: number; // default 15
  lock_buffer_after_min: number;    // default 15
  lock_timing_mode?: LockTimingMode; // default 'after_end'
  lock_after_start_min?: number;    // default 15
  poll_interval_min: number;        // default 30
  timezone: string;                 // e.g. "America/Chicago"
  enable_user_sync?: boolean;       // Opt-in flag for syncing PCO Lists to UniFi Users & Policies
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

export interface DoorTimingConfig {
  unlock_offset_min?: number;
  lock_timing_mode?: LockTimingMode;
  lock_offset_min?: number;
}

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
  lock_timing_mode?: LockTimingMode;
  lock_offset_min?: number;
  unlock_offset_min?: number;
  /** Custom per-door lock and unlock timing overrides */
  door_timings?: Record<string, DoorTimingConfig>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccessPolicyMapping {
  id: string;
  org_id: string;
  pco_list_id: string;
  pco_list_name: string;
  unifi_policy_id: string;
  unifi_policy_name: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SyncedUser {
  id: string;                      // Firestore document ID (e.g. pco_person_id)
  org_id: string;
  pco_person_id: string;
  unifi_user_id?: string;
  first_name: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  phone_number?: string;
  active_list_ids: string[];
  active_list_names?: string[];
  assigned_policy_ids: string[];
  assigned_policy_names?: string[];
  status: 'active' | 'pending' | 'no_policy' | 'error';
  sync_error?: string;
  last_synced_at: string;
  created_at?: string;
  updated_at?: string;
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
  campus_id?: string | null;
  campus_name?: string | null;
  location_id?: string | null;
  location_name?: string | null;
  building?: string | null;
  floor?: string | null;
  is_held_unlocked?: boolean;
  hold_unlock_expires_at?: string | null;
  unlock_duration_min?: number | null;
  last_unlocked_at?: string | null;
  last_locked_at?: string | null;
  unlock_trigger?: 'scheduler' | 'manual' | 'agent' | string | null;
  unlocked_by_user_id?: string | null;
  schedule_id?: string | null;
  schedule_name?: string | null;
  unlock_schedule_name?: string | null;
  last_accessed_at?: string | null;
  last_accessed_by?: string | null;
  last_access_method?: string | null;
  last_access_method_label?: string | null;
  last_synced: string; // ISO8601
}

// ─── Schedule Windows ─────────────────────────────────────────────────────────

export type ScheduleWindowStatus = 'pending' | 'unlocked' | 'locked' | 'cancelled' | 'error';

export interface ScheduleWindowDoorTiming {
  unlock_at: string;
  lock_at: string;
  unlock_offset_min?: number;
  lock_offset_min?: number;
  lock_timing_mode?: LockTimingMode;
}

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
  lock_at: string;            // ends_at + buffer (or starts_at + offset)
  lock_timing_mode?: LockTimingMode;
  door_ids: string[];
  door_labels: string[];
  /** Door-specific unlock and lock schedules */
  door_timings?: Record<string, ScheduleWindowDoorTiming>;
  status: ScheduleWindowStatus;
  updated_at: string;
}

// ─── Door & User Commands ─────────────────────────────────────────────────────

export type CommandAction =
  | 'unlock'
  | 'lock'
  | 'sync_doors'
  | 'sync_schedules'
  | 'update_schedule'
  | 'create_schedule'
  | 'delete_schedule'
  | 'sync_visitors'
  | 'create_visitor'
  | 'update_visitor'
  | 'delete_visitor'
  | 'sync_users'
  | 'create_user'
  | 'update_user'
  | 'assign_policies'
  | 'sync_policies'
  | 'create_policy'
  | 'update_policy'
  | 'delete_policy'
  | 'sync_access_logs'
  | 'apply_update'
  | 'upgrade_agent'
  | 'restart_agent';

export type CommandStatus = 'queued' | 'executing' | 'done' | 'failed' | 'cancelled' | 'skipped';

export interface DoorCommand {
  id: string;
  org_id: string;
  door_id?: string;
  door_label?: string;
  schedule_id?: string;
  schedule_data?: Record<string, unknown>;
  visitor_id?: string;
  visitor_data?: Record<string, unknown>;
  user_id?: string;
  unifi_user_id?: string;
  user_data?: Record<string, unknown>;
  policy_id?: string;
  policy_data?: Record<string, unknown>;
  policy_ids?: string[];
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
  | 'visitor_synced'
  | 'user_created'
  | 'user_updated'
  | 'policies_assigned'
  | 'user_sync';

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
  local_ip?: string;
  hostname?: string;
  platform?: string;
}

// ─── PCO API ──────────────────────────────────────────────────────────────────

export interface PcoTimeInfo {
  id: string;
  name?: string;
  starts_at: string;
  ends_at?: string;
  time_type?: PlanTimeType | string;
  formatted?: string;
}

export interface PcoServiceType {
  id: string;
  name: string;
  frequency?: string;
  upcoming_plan_title?: string;
  upcoming_plan_date?: string;
  upcoming_times?: PcoTimeInfo[];
  attributes?: Record<string, unknown>;
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
  schedule?: string;
  upcoming_times?: PcoTimeInfo[];
  attributes?: Record<string, unknown>;
}

export interface PcoGroupEvent {
  id: string;
  group_id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  location?: string;
}

export interface PcoList {
  id: string;
  name: string;
  category?: string;
  total_people?: number;
  updated_at?: string;
  attributes?: Record<string, unknown>;
}

export interface PcoPerson {
  id: string;
  first_name: string;
  last_name?: string;
  name: string;
  email?: string;
  phone_number?: string;
  avatar?: string;
  status?: string;
}

export interface PcoCampus {
  id: string;
  org_id?: string;
  name: string;
  description?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  time_zone?: string;
  phone_number?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PcoLocation {
  id: string;
  org_id?: string;
  name: string;
  campus_id?: string | null;
  campus_name?: string | null;
  kind?: 'room' | 'resource' | 'building' | 'location' | string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

// ─── UniFi API ────────────────────────────────────────────────────────────────

export interface UnifiAccessPolicy {
  id: string;
  org_id?: string;
  unifi_policy_id: string;
  name: string;
  door_ids?: string[];
  door_labels?: string[];
  schedule_id?: string;
  schedule_name?: string;
  description?: string;
  holiday_group_id?: string;
  user_count?: number;
  sync_status?: 'synced' | 'pending' | 'error';
  sync_error?: string | null;
  raw_data?: Record<string, unknown>;
  last_synced?: string;
  created_at?: string;
  updated_at?: string;
}

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
