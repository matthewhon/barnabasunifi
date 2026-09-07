import { format, formatDistanceToNow, isPast } from 'date-fns';

/**
 * Safely parses any date representation (ISO string, Timestamp object, Date, epoch)
 * into a valid Date object or null if invalid.
 */
export function parseSafeDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof (val as any)?.toDate === 'function') {
    try {
      const d = (val as any).toDate();
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  if (typeof val === 'object' && val !== null) {
    if ('_seconds' in (val as any) && typeof (val as any)._seconds === 'number') {
      const d = new Date((val as any)._seconds * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    if ('seconds' in (val as any) && typeof (val as any).seconds === 'number') {
      const d = new Date((val as any).seconds * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
  }
  if (typeof val === 'number') {
    const ms = val < 100000000000 ? val * 1000 : val;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'string') {
    if (/^\d{10}$/.test(val)) {
      const d = new Date(parseInt(val, 10) * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    if (/^\d{13}$/.test(val)) {
      const d = new Date(parseInt(val, 10));
      return isNaN(d.getTime()) ? null : d;
    }
    try {
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  try {
    const d = new Date(val as any);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * Safely formats distance to now, falling back to a default string if invalid.
 */
export function safeFormatDistanceToNow(val: unknown, fallback = '—'): string {
  const d = parseSafeDate(val);
  if (!d) return fallback;
  try {
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return fallback;
  }
}

/**
 * Safely formats a date string, falling back to a default string if invalid.
 */
export function safeFormat(val: unknown, formatStr: string, fallback = '—'): string {
  const d = parseSafeDate(val);
  if (!d) return fallback;
  try {
    return format(d, formatStr);
  } catch {
    return fallback;
  }
}

/**
 * Safely checks if a date is in the past.
 */
export function safeIsPast(val: unknown): boolean {
  const d = parseSafeDate(val);
  if (!d) return false;
  try {
    return isPast(d);
  } catch {
    return false;
  }
}
