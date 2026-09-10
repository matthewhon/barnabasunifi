import type { Door, ScheduleWindow, UnifiSchedule, DayOfWeek } from '@/lib/types';
import { safeFormat, safeFormatDistanceToNow } from '@/lib/date-utils';

const DAYS: DayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

function formatTime12h(time24: string): string {
  if (!time24) return '';
  const [hStr, mStr] = time24.split(':');
  const h = parseInt(hStr, 10);
  if (isNaN(h)) return time24;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${mStr || '00'} ${ampm}`;
}

function formatDurationMinutes(mins: number): string {
  if (mins < 1) return '< 1m';
  if (mins < 60) return `${Math.round(mins)}m`;
  const hours = Math.floor(mins / 60);
  const remainingMins = Math.round(mins % 60);
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

export interface DoorUnlockStatusInfo {
  isLocked: boolean;
  isUnlocked: boolean;
  isUnknown: boolean;
  isHeldUnlocked: boolean;
  isDoorOpen: boolean;

  // Policy status
  isWithinPolicy: boolean;
  isOutsidePolicy: boolean;

  // Matched policies
  activeScheduleWindow?: ScheduleWindow | null;
  activeWeeklySlot?: {
    scheduleName: string;
    day: DayOfWeek;
    slot: { start_time: string; end_time: string };
  } | null;

  // Timing metrics
  durationSetMin?: number | null;
  unlockedAt?: Date | null;
  expiresAt?: Date | null;
  remainingMinutes?: number | null;
  elapsedMinutes?: number | null;
  isExpired?: boolean;

  // Human-readable labels
  durationLabel: string | null;
  policyLabel: string;
  statusSummary: string;

  // Badge for cards / tables
  badge: {
    text: string;
    variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
    icon: string;
    subtext?: string;
  };
}

/**
 * Evaluates a door's current state against active PCO schedule windows and UniFi unlock schedules.
 * Returns complete duration metrics, remaining countdown, and whether the door is unlocked outside policy.
 */
export function getDoorUnlockStatus(
  door: Door,
  schedules: UnifiSchedule[] = [],
  scheduleWindows: ScheduleWindow[] = [],
  referenceDate: Date = new Date()
): DoorUnlockStatusInfo {
  const isLocked = door.current_state === 'locked';
  const isUnlocked = door.current_state === 'unlocked';
  const isUnknown = door.current_state === 'unknown';
  const isHeldUnlocked = Boolean(door.is_held_unlocked);
  const isDoorOpen = door.door_position_status === 'open';

  if (!isUnlocked) {
    return {
      isLocked,
      isUnlocked,
      isUnknown,
      isHeldUnlocked: false,
      isDoorOpen,
      isWithinPolicy: true,
      isOutsidePolicy: false,
      durationLabel: null,
      policyLabel: 'Standard Policy',
      statusSummary: isLocked ? 'Door is securely locked' : 'Status unknown',
      badge: {
        text: isLocked ? 'Locked' : 'Unknown',
        variant: isLocked ? 'danger' : 'neutral',
        icon: isLocked ? '🔒' : '❓',
        subtext: door.last_synced ? `Synced ${safeFormatDistanceToNow(door.last_synced)}` : undefined,
      },
    };
  }

  const nowMs = referenceDate.getTime();

  // 1. Check for active Planning Center Schedule Windows
  const doorId = door.id;
  const unifiDoorId = door.unifi_door_id;
  const activeWindow = scheduleWindows.find((w) => {
    if (w.status === 'cancelled') return false;
    const matchesDoor =
      (w.door_ids && (w.door_ids.includes(doorId) || (unifiDoorId && w.door_ids.includes(unifiDoorId)))) ||
      (w.door_labels && w.door_labels.includes(door.label));
    if (!matchesDoor) return false;

    const doorTiming = w.door_timings?.[doorId] || (unifiDoorId ? w.door_timings?.[unifiDoorId] : undefined);
    const unlockMs = new Date(doorTiming?.unlock_at || w.unlock_at).getTime();
    const lockMs = new Date(doorTiming?.lock_at || w.lock_at).getTime();
    return nowMs >= unlockMs && nowMs <= lockMs;
  });

  const activeDoorTiming = activeWindow
    ? activeWindow.door_timings?.[doorId] || (unifiDoorId ? activeWindow.door_timings?.[unifiDoorId] : undefined)
    : undefined;

  // 2. Check for active UniFi Weekly Unlock Schedule slot
  const dayName = DAYS[referenceDate.getDay()];
  const currentHours = referenceDate.getHours();
  const currentMins = referenceDate.getMinutes();
  const currentMinutesFromMidnight = currentHours * 60 + currentMins;

  let activeWeeklySlot: DoorUnlockStatusInfo['activeWeeklySlot'] = null;

  // Filter schedules assigned to this door
  const assignedSchedules = schedules.filter((s) => {
    const matchesId = s.id === door.schedule_id || s.unifi_schedule_id === door.schedule_id;
    const matchesDoorList =
      s.door_ids?.includes(doorId) || (unifiDoorId && s.door_ids?.includes(unifiDoorId));
    const isUnlockSchedule = s.type === 'unlock' || Boolean(s.is_default);
    return (matchesId || matchesDoorList) && isUnlockSchedule;
  });

  for (const sched of assignedSchedules) {
    const dayConfig = sched.weekly_schedule?.find((d) => d.day === dayName && d.active);
    if (dayConfig && dayConfig.slots) {
      for (const slot of dayConfig.slots) {
        const [startH, startM] = slot.start_time.split(':').map((v) => parseInt(v, 10));
        const [endH, endM] = slot.end_time.split(':').map((v) => parseInt(v, 10));
        const startMins = startH * 60 + (startM || 0);
        const endMins = endH * 60 + (endM || 0);

        if (currentMinutesFromMidnight >= startMins && currentMinutesFromMidnight <= endMins) {
          activeWeeklySlot = {
            scheduleName: sched.name,
            day: dayName,
            slot,
          };
          break;
        }
      }
    }
    if (activeWeeklySlot) break;
  }

  const isWithinPolicy = Boolean(activeWindow || activeWeeklySlot);
  const isOutsidePolicy = !isWithinPolicy;

  // 3. Compute Timing, Expiration, and Durations
  let durationSetMin: number | null = door.unlock_duration_min ?? null;
  let expiresAt: Date | null = null;
  let unlockedAt: Date | null = door.last_unlocked_at ? new Date(door.last_unlocked_at) : null;

  if (door.hold_unlock_expires_at) {
    expiresAt = new Date(door.hold_unlock_expires_at);
  } else if (activeWindow) {
    expiresAt = new Date(activeDoorTiming?.lock_at || activeWindow.lock_at);
    const windowStartMs = new Date(activeDoorTiming?.unlock_at || activeWindow.unlock_at).getTime();
    durationSetMin = Math.round((expiresAt.getTime() - windowStartMs) / 60000);
  } else if (activeWeeklySlot) {
    const [endH, endM] = activeWeeklySlot.slot.end_time.split(':').map((v) => parseInt(v, 10));
    const slotEndDate = new Date(referenceDate);
    slotEndDate.setHours(endH, endM || 0, 0, 0);
    expiresAt = slotEndDate;
  } else if (durationSetMin && unlockedAt) {
    expiresAt = new Date(unlockedAt.getTime() + durationSetMin * 60000);
  }

  let remainingMinutes: number | null = null;
  let isExpired = false;

  if (expiresAt) {
    const remainingMs = expiresAt.getTime() - nowMs;
    remainingMinutes = Math.max(0, Math.round(remainingMs / 60000));
    isExpired = remainingMs <= 0;
  }

  let elapsedMinutes: number | null = null;
  if (unlockedAt) {
    elapsedMinutes = Math.max(0, Math.round((nowMs - unlockedAt.getTime()) / 60000));
  } else if (door.last_synced && isOutsidePolicy) {
    elapsedMinutes = Math.max(0, Math.round((nowMs - new Date(door.last_synced).getTime()) / 60000));
  }

  // 4. Construct human-readable labels and UI Badges
  let durationLabel: string | null = null;
  let policyLabel = 'Schedule Window';
  let statusSummary = '';

  if (activeWindow) {
    policyLabel = activeWindow.source_label || 'Planning Center Event';
    const remainingStr = remainingMinutes !== null ? `${formatDurationMinutes(remainingMinutes)} remaining` : '';
    const lockTimeStr = safeFormat(activeDoorTiming?.lock_at || activeWindow.lock_at, 'h:mm a');
    durationLabel = `Scheduled until ${lockTimeStr} (${remainingStr})`;
    statusSummary = `Unlocked for "${policyLabel}" · Relocks at ${lockTimeStr}`;

    return {
      isLocked,
      isUnlocked,
      isUnknown,
      isHeldUnlocked,
      isDoorOpen,
      isWithinPolicy: true,
      isOutsidePolicy: false,
      activeScheduleWindow: activeWindow,
      activeWeeklySlot: null,
      durationSetMin,
      unlockedAt,
      expiresAt,
      remainingMinutes,
      elapsedMinutes,
      isExpired: false,
      durationLabel,
      policyLabel,
      statusSummary,
      badge: {
        text: `Unlocked · ${remainingStr}`,
        variant: 'success',
        icon: '🗓️',
        subtext: `Policy: ${policyLabel} (until ${lockTimeStr})`,
      },
    };
  }

  if (activeWeeklySlot) {
    policyLabel = activeWeeklySlot.scheduleName || 'Weekly Unlock Schedule';
    const endFormatted = formatTime12h(activeWeeklySlot.slot.end_time);
    const remainingStr = remainingMinutes !== null ? `${formatDurationMinutes(remainingMinutes)} remaining` : '';
    durationLabel = `Open until ${endFormatted} (${remainingStr})`;
    statusSummary = `Unlocked on schedule "${policyLabel}" until ${endFormatted}`;

    return {
      isLocked,
      isUnlocked,
      isUnknown,
      isHeldUnlocked,
      isDoorOpen,
      isWithinPolicy: true,
      isOutsidePolicy: false,
      activeScheduleWindow: null,
      activeWeeklySlot,
      durationSetMin,
      unlockedAt,
      expiresAt,
      remainingMinutes,
      elapsedMinutes,
      isExpired: false,
      durationLabel,
      policyLabel,
      statusSummary,
      badge: {
        text: `Unlocked · Until ${endFormatted}`,
        variant: 'success',
        icon: '🕒',
        subtext: `Schedule: ${policyLabel} (${remainingStr})`,
      },
    };
  }

  // 5. Outside Policy / Manual Unlocks
  policyLabel = 'Outside Policy (Manual / Override)';

  if (durationSetMin && expiresAt && !isExpired) {
    const remainingStr = formatDurationMinutes(remainingMinutes ?? 0);
    const expireTimeStr = safeFormat(expiresAt.toISOString(), 'h:mm a');
    durationLabel = `Set for ${durationSetMin}m · ${remainingStr} remaining (until ${expireTimeStr})`;
    statusSummary = `Manually unlocked for ${durationSetMin} min (relocks at ${expireTimeStr})`;

    return {
      isLocked,
      isUnlocked,
      isUnknown,
      isHeldUnlocked: true,
      isDoorOpen,
      isWithinPolicy: false,
      isOutsidePolicy: true,
      activeScheduleWindow: null,
      activeWeeklySlot: null,
      durationSetMin,
      unlockedAt,
      expiresAt,
      remainingMinutes,
      elapsedMinutes,
      isExpired: false,
      durationLabel,
      policyLabel,
      statusSummary,
      badge: {
        text: `Manual Unlock · ${remainingStr} left`,
        variant: 'warning',
        icon: '⏱️',
        subtext: `Set for ${durationSetMin}m outside schedule (relocks ${expireTimeStr})`,
      },
    };
  }

  // Unlocked without timer or expired timer outside scheduled policy
  const elapsedStr = elapsedMinutes !== null ? formatDurationMinutes(elapsedMinutes) : null;
  const sinceStr = unlockedAt ? safeFormat(unlockedAt.toISOString(), 'h:mm a') : null;

  if (elapsedStr && sinceStr) {
    durationLabel = `Left unlocked for ${elapsedStr} (since ${sinceStr})`;
  } else if (elapsedStr) {
    durationLabel = `Left unlocked for ${elapsedStr}`;
  } else if (durationSetMin) {
    durationLabel = `Originally set for ${durationSetMin}m (manual override)`;
  } else {
    durationLabel = isHeldUnlocked ? 'Held unlocked indefinitely' : 'Unlocked outside scheduled policy';
  }

  statusSummary = isDoorOpen
    ? `⚠️ Door physically open & unlocked outside policy (${durationLabel})`
    : `⚠️ Door left unlocked outside policy (${durationLabel})`;

  return {
    isLocked,
    isUnlocked,
    isUnknown,
    isHeldUnlocked,
    isDoorOpen,
    isWithinPolicy: false,
    isOutsidePolicy: true,
    activeScheduleWindow: null,
    activeWeeklySlot: null,
    durationSetMin,
    unlockedAt,
    expiresAt,
    remainingMinutes: 0,
    elapsedMinutes,
    isExpired: true,
    durationLabel,
    policyLabel,
    statusSummary,
    badge: {
      text: 'Outside Policy',
      variant: 'danger',
      icon: '⚠️',
      subtext: durationLabel || 'No active unlock schedule for this door',
    },
  };
}
