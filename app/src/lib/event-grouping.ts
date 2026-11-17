import { parseSafeDate } from './date-utils';
import type { ScheduleWindow } from './types';

export interface EventLocationInfo {
  key: string;
  label: string;
  hasLocation: boolean;
  isVirtual: boolean;
}

export interface TimeLocationGroup {
  groupKey: string;
  startsAt: string;
  endsAt: string;
  startMs: number;
  endMs: number;
  locationLabel: string;
  hasLocation: boolean;
  isVirtual: boolean;
  /** Displayed windows belonging to this time + location group */
  windows: ScheduleWindow[];
  /** All upcoming windows in this exact time + location slot (including mapped ones) */
  allSlotWindows: ScheduleWindow[];
  /** True when at least one event in this time + location slot already has doors mapped */
  hasRuleInPlace: boolean;
  /** Mapped windows in this slot that provide door coverage */
  coveringWindows: ScheduleWindow[];
  /** Human-readable rule / event names providing coverage */
  coveringRuleNames: string[];
  /** Unique door labels covered by existing rules in this slot */
  coveringDoorLabels: string[];
  /** Unmapped, non-dismissed windows in `windows` */
  unmappedWindows: ScheduleWindow[];
}

/**
 * Extracts a normalized location key and display label for a ScheduleWindow.
 */
export function getEventLocationInfo(win: ScheduleWindow): EventLocationInfo {
  const name = win.pco_location_name?.trim() || '';
  if (win.pco_location_id) {
    return {
      key: `id:${win.pco_location_id}`,
      label: name || `Location ${win.pco_location_id}`,
      hasLocation: true,
      isVirtual: false,
    };
  }
  if (name) {
    return {
      key: `name:${name.toLowerCase()}`,
      label: name,
      hasLocation: true,
      isVirtual: false,
    };
  }
  if (win.location_type_preference === 'virtual') {
    return {
      key: 'virtual',
      label: 'Virtual / Online',
      hasLocation: false,
      isVirtual: true,
    };
  }
  return {
    key: 'none',
    label: 'No Location Set',
    hasLocation: false,
    isVirtual: false,
  };
}

/**
 * Builds a deterministic grouping key for a window's start time, end time, and location.
 */
export function getTimeLocationKey(win: ScheduleWindow): string {
  const startMs = parseSafeDate(win.starts_at)?.getTime();
  const endMs = parseSafeDate(win.ends_at)?.getTime();
  const loc = getEventLocationInfo(win);

  if (startMs === undefined || endMs === undefined || isNaN(startMs) || isNaN(endMs)) {
    return `invalid:${win.id}:${loc.key}`;
  }
  return `${startMs}_${endMs}_${loc.key}`;
}

/**
 * Groups `displayedWindows` by exact time (starts_at + ends_at) and PCO location,
 * while checking `allUpcomingWindows` to determine whether a door rule is already
 * in place for that time + location slot.
 */
export function groupEventsByTimeAndLocation(
  displayedWindows: ScheduleWindow[],
  allUpcomingWindows: ScheduleWindow[]
): TimeLocationGroup[] {
  // Index all upcoming windows by time+location so coverage detection works
  // even when `displayedWindows` is filtered (e.g. Unmapped tab).
  const slotIndex = new Map<string, ScheduleWindow[]>();
  for (const win of allUpcomingWindows) {
    const key = getTimeLocationKey(win);
    const list = slotIndex.get(key);
    if (list) {
      list.push(win);
    } else {
      slotIndex.set(key, [win]);
    }
  }

  const groupMap = new Map<string, TimeLocationGroup>();

  for (const win of displayedWindows) {
    const key = getTimeLocationKey(win);
    let group = groupMap.get(key);

    if (!group) {
      const loc = getEventLocationInfo(win);
      const startMs = parseSafeDate(win.starts_at)?.getTime() ?? 0;
      const endMs = parseSafeDate(win.ends_at)?.getTime() ?? 0;
      const allSlotWindows = slotIndex.get(key) ?? [win];

      const coveringWindows = allSlotWindows.filter(
        (w) => Array.isArray(w.door_ids) && w.door_ids.length > 0
      );

      const ruleNameSet = new Set<string>();
      const doorLabelSet = new Set<string>();
      for (const cw of coveringWindows) {
        const ruleLabel = cw.mapping_name?.trim() || cw.source_label;
        if (ruleLabel) ruleNameSet.add(ruleLabel);
        for (const dl of cw.door_labels || []) {
          if (dl) doorLabelSet.add(dl);
        }
      }

      group = {
        groupKey: key,
        startsAt: win.starts_at,
        endsAt: win.ends_at,
        startMs,
        endMs,
        locationLabel: loc.label,
        hasLocation: loc.hasLocation,
        isVirtual: loc.isVirtual,
        windows: [],
        allSlotWindows,
        hasRuleInPlace: coveringWindows.length > 0,
        coveringWindows,
        coveringRuleNames: Array.from(ruleNameSet),
        coveringDoorLabels: Array.from(doorLabelSet),
        unmappedWindows: [],
      };
      groupMap.set(key, group);
    }

    group.windows.push(win);
    if ((!win.door_ids || win.door_ids.length === 0) && win.review_status !== 'dismissed') {
      group.unmappedWindows.push(win);
    }
  }

  const groups = Array.from(groupMap.values());
  for (const g of groups) {
    g.windows.sort((a, b) => a.source_label.localeCompare(b.source_label));
  }

  return groups.sort((a, b) => {
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    if (a.endMs !== b.endMs) return a.endMs - b.endMs;
    return a.locationLabel.localeCompare(b.locationLabel);
  });
}
