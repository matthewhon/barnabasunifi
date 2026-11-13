'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  getOrgSettings,
  subscribeToScheduleWindows,
  subscribeToUnifiSchedules,
} from '@/lib/firestore';
import type { DayOfWeek, ScheduleWindow, UnifiSchedule } from '@/lib/types';
import { formatDoorShortName } from '@/lib/door-status-utils';
import { safeIsPast } from '@/lib/date-utils';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { CalendarClock, Clock, DoorOpen, Repeat, Search } from 'lucide-react';

const WEEK_DAYS: { key: DayOfWeek; letter: string }[] = [
  { key: 'monday', letter: 'M' },
  { key: 'tuesday', letter: 'T' },
  { key: 'wednesday', letter: 'W' },
  { key: 'thursday', letter: 'T' },
  { key: 'friday', letter: 'F' },
  { key: 'saturday', letter: 'S' },
  { key: 'sunday', letter: 'S' },
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

function formatZoned(iso: string, tz: string, pattern: string): string {
  try {
    return format(toZonedTime(new Date(iso), tz), pattern);
  } catch {
    return format(new Date(iso), pattern);
  }
}

function getDayGroupLabel(iso: string, tz: string): string {
  const dayKey = formatZoned(iso, tz, 'yyyy-MM-dd');
  const nowIso = new Date().toISOString();
  const todayKey = formatZoned(nowIso, tz, 'yyyy-MM-dd');
  const tomorrowIso = new Date(Date.now() + 86400000).toISOString();
  const tomorrowKey = formatZoned(tomorrowIso, tz, 'yyyy-MM-dd');

  if (dayKey === todayKey) return 'Today';
  if (dayKey === tomorrowKey) return 'Tomorrow';
  return formatZoned(iso, tz, 'EEE, MMM d');
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'unlocked':
      return 'badge-success';
    case 'pending':
      return 'badge-info';
    case 'cancelled':
      return 'badge-warning';
    case 'error':
      return 'badge-danger';
    default:
      return 'badge-neutral';
  }
}

function summarizeWeekly(schedule: UnifiSchedule): string {
  const weekly = schedule.weekly_schedule;
  if (!weekly || weekly.length === 0) return 'No hours configured';
  const active = weekly.filter((d) => d.active && d.slots && d.slots.length > 0);
  if (active.length === 0) return 'Always locked (no active days)';

  return active
    .map((d) => {
      const slots = d.slots
        .map((s) => `${formatTime12h(s.start_time)}–${formatTime12h(s.end_time)}`)
        .join(', ');
      return `${d.day.slice(0, 3).toUpperCase()}: ${slots}`;
    })
    .join(' · ');
}

export default function MobileSchedulesPage() {
  const { orgId } = useAuth();

  const [tab, setTab] = useState<'upcoming' | 'weekly'>('upcoming');
  const [windows, setWindows] = useState<ScheduleWindow[]>([]);
  const [weeklySchedules, setWeeklySchedules] = useState<UnifiSchedule[]>([]);
  const [timezone, setTimezone] = useState<string>('America/Chicago');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    let firstLoad = true;

    const unsubWindows = subscribeToScheduleWindows(orgId, (list) => {
      setWindows(list);
      if (firstLoad) {
        firstLoad = false;
        setLoading(false);
      }
    });
    const unsubWeekly = subscribeToUnifiSchedules(orgId, setWeeklySchedules);
    getOrgSettings(orgId)
      .then((s) => {
        if (s?.timezone) setTimezone(s.timezone);
      })
      .catch(() => {});

    return () => {
      unsubWindows();
      unsubWeekly();
    };
  }, [orgId]);

  const upcomingGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const upcoming = windows
      .filter((w) => {
        if (w.status === 'cancelled' || w.status === 'locked') return false;
        const endIso = w.lock_at || w.ends_at;
        if (endIso && safeIsPast(endIso)) return false;
        if (q) {
          const hay = `${w.source_label} ${(w.door_labels || []).join(' ')}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(a.unlock_at || a.starts_at).getTime() - new Date(b.unlock_at || b.starts_at).getTime());

    const activeNow: ScheduleWindow[] = [];
    const grouped = new Map<string, ScheduleWindow[]>();

    for (const w of upcoming) {
      const unlockMs = new Date(w.unlock_at || w.starts_at).getTime();
      const lockMs = new Date(w.lock_at || w.ends_at).getTime();
      const nowMs = Date.now();
      if (w.status === 'unlocked' || (nowMs >= unlockMs && nowMs <= lockMs)) {
        activeNow.push(w);
        continue;
      }
      const groupLabel = getDayGroupLabel(w.unlock_at || w.starts_at, timezone);
      const arr = grouped.get(groupLabel) || [];
      arr.push(w);
      grouped.set(groupLabel, arr);
    }

    return { activeNow, grouped: Array.from(grouped.entries()), totalCount: upcoming.length };
  }, [windows, search, timezone]);

  const filteredWeekly = useMemo(() => {
    const q = search.trim().toLowerCase();
    return weeklySchedules.filter((s) => {
      if (!q) return true;
      const hay = `${s.name} ${(s.door_labels || []).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [weeklySchedules, search]);

  const renderWindowCard = (w: ScheduleWindow, highlightActive = false) => {
    const unlockLabel = formatZoned(w.unlock_at || w.starts_at, timezone, 'h:mm a');
    const lockLabel = formatZoned(w.lock_at || w.ends_at, timezone, 'h:mm a');
    const eventStart = formatZoned(w.starts_at, timezone, 'h:mm a');
    const eventEnd = formatZoned(w.ends_at, timezone, 'h:mm a');

    return (
      <article
        key={w.id}
        style={{
          background: 'var(--color-bg-surface)',
          border: `1px solid ${
            highlightActive ? 'rgba(34, 197, 94, 0.45)' : 'var(--color-border)'
          }`,
          borderRadius: 'var(--radius-xl)',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.3 }}>
            {w.source_label}
          </h3>
          <span className={`badge ${statusBadgeClass(w.status)}`} style={{ flexShrink: 0 }}>
            {w.status}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.8125rem',
            color: 'var(--color-text-secondary)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: 'var(--color-text-primary)', fontWeight: 600 }}>
            <Clock size={14} style={{ color: 'var(--color-accent-hover)' }} />
            Doors {unlockLabel} – {lockLabel}
          </span>
          <span style={{ color: 'var(--color-text-muted)' }}>
            (Event {eventStart}–{eventEnd})
          </span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.375rem', marginTop: '0.125rem' }}>
          <span className={`badge ${w.source_type === 'service' ? 'badge-info' : 'badge-neutral'}`}>
            {w.source_type}
          </span>
          {(w.door_labels || []).map((label) => (
            <span
              key={label}
              style={{
                fontSize: '0.75rem',
                padding: '0.1875rem 0.5rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              <DoorOpen size={11} />
              {formatDoorShortName(label)}
            </span>
          ))}
        </div>
      </article>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, lineHeight: 1.2 }}>Schedules</h1>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', marginTop: '0.125rem' }}>
          Upcoming Planning Center unlocks &amp; recurring door hours
        </p>
      </div>

      {/* Segmented Control */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.375rem',
          padding: '0.25rem',
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        <button
          type="button"
          onClick={() => setTab('upcoming')}
          aria-pressed={tab === 'upcoming'}
          style={{
            minHeight: '42px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: tab === 'upcoming' ? 'var(--color-accent)' : 'transparent',
            color: tab === 'upcoming' ? '#ffffff' : 'var(--color-text-secondary)',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.375rem',
          }}
        >
          <CalendarClock size={16} />
          <span>Upcoming ({upcomingGroups.totalCount})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('weekly')}
          aria-pressed={tab === 'weekly'}
          style={{
            minHeight: '42px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: tab === 'weekly' ? 'var(--color-accent)' : 'transparent',
            color: tab === 'weekly' ? '#ffffff' : 'var(--color-text-secondary)',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.375rem',
          }}
        >
          <Repeat size={16} />
          <span>Weekly ({weeklySchedules.length})</span>
        </button>
      </div>

      {/* Search */}
      <div style={{ position: 'relative' }}>
        <Search
          size={18}
          style={{
            position: 'absolute',
            left: '0.875rem',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--color-text-muted)',
            pointerEvents: 'none',
          }}
        />
        <input
          type="search"
          aria-label="Search schedules"
          placeholder={tab === 'upcoming' ? 'Search events or doors…' : 'Search weekly schedules…'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mobile-input"
          style={{ paddingLeft: '2.625rem' }}
          enterKeyHint="search"
        />
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 0' }}>
          <LoadingSpinner />
        </div>
      ) : tab === 'upcoming' ? (
        upcomingGroups.totalCount === 0 ? (
          <div
            style={{
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-xl)',
              padding: '2rem 1.25rem',
              textAlign: 'center',
              color: 'var(--color-text-secondary)',
            }}
          >
            <CalendarClock size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.5 }} />
            <p style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '0.25rem' }}>
              No upcoming schedules
            </p>
            <p style={{ fontSize: '0.8125rem' }}>
              {search
                ? 'Try clearing your search filter.'
                : 'Upcoming Planning Center events mapped to doors will appear here.'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {upcomingGroups.activeNow.length > 0 && (
              <section style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                <h2
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--color-success)',
                  }}
                >
                  Active Now
                </h2>
                {upcomingGroups.activeNow.map((w) => renderWindowCard(w, true))}
              </section>
            )}

            {upcomingGroups.grouped.map(([dayLabel, items]) => (
              <section
                key={dayLabel}
                style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}
              >
                <h2
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  {dayLabel}
                </h2>
                {items.map((w) => renderWindowCard(w))}
              </section>
            ))}
          </div>
        )
      ) : filteredWeekly.length === 0 ? (
        <div
          style={{
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-xl)',
            padding: '2rem 1.25rem',
            textAlign: 'center',
            color: 'var(--color-text-secondary)',
          }}
        >
          <Repeat size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.5 }} />
          <p style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '0.25rem' }}>
            No weekly schedules
          </p>
          <p style={{ fontSize: '0.8125rem' }}>
            Recurring UniFi Access unlock schedules will appear here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filteredWeekly.map((s) => (
            <article
              key={s.id}
              style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-xl)',
                padding: '1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.625rem',
              }}
            >
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {s.name || 'Unlock Schedule'}
              </h2>

              {/* Day pills */}
              <div style={{ display: 'flex', gap: '0.375rem' }}>
                {WEEK_DAYS.map((d) => {
                  const dayCfg = s.weekly_schedule?.find((item) => item.day === d.key);
                  const active = Boolean(dayCfg?.active && dayCfg.slots?.length);
                  return (
                    <span
                      key={d.key}
                      style={{
                        width: '1.75rem',
                        height: '1.75rem',
                        borderRadius: '9999px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: active ? 'rgba(36, 101, 245, 0.2)' : 'var(--color-bg-base)',
                        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                        color: active ? '#93c5fd' : 'var(--color-text-muted)',
                      }}
                    >
                      {d.letter}
                    </span>
                  );
                })}
              </div>

              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                {summarizeWeekly(s)}
              </p>

              {s.door_labels && s.door_labels.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                  {s.door_labels.map((label) => (
                    <span
                      key={label}
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.1875rem 0.5rem',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-bg-elevated)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-secondary)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                      }}
                    >
                      <DoorOpen size={11} />
                      {formatDoorShortName(label)}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
