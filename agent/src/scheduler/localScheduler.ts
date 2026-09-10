/**
 * scheduler/localScheduler.ts
 * Autonomous local schedule runner.
 *
 * Runs on a fixed interval (every 10 seconds), evaluates cached schedule windows,
 * and directly triggers UniFi Access API unlock and lock operations over LAN.
 * Works seamlessly whether internet is connected or down.
 */

import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { UnifiAccessClient } from '../unifi/access';
import { logger } from '../logger';
import { getCacheStore, CacheStore, CachedScheduleWindow, OfflineActionRecord } from '../storage/cacheStore';
import { getDb } from '../firebase';

export interface NextScheduledItem {
  action: 'unlock' | 'lock';
  doorId: string;
  doorLabel: string;
  time: string; // ISO string
  windowId: string;
  sourceLabel: string;
}

export class LocalScheduler {
  private orgId: string;
  private agentId: string;
  private unifiClient: UnifiAccessClient;
  private isOnline: () => boolean;
  private cacheStore: CacheStore;
  private timer: NodeJS.Timeout | null = null;
  private isExecuting = false;

  constructor(
    orgId: string,
    agentId: string,
    unifiClient: UnifiAccessClient,
    isOnline: () => boolean,
    cacheStore?: CacheStore
  ) {
    this.orgId = orgId;
    this.agentId = agentId;
    this.unifiClient = unifiClient;
    this.isOnline = isOnline;
    this.cacheStore = cacheStore || getCacheStore();
  }

  public start(intervalMs = 10000): void {
    if (this.timer) return;
    logger.info(`[LocalScheduler] Started local autonomous scheduler (tick every ${intervalMs / 1000}s).`);
    // Run an immediate evaluation tick
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('[LocalScheduler] Stopped local autonomous scheduler.');
    }
  }

  /**
   * Main evaluation loop.
   */
  public async tick(): Promise<void> {
    if (this.isExecuting) return;
    this.isExecuting = true;

    try {
      const cacheStore = this.cacheStore;
      const windows = cacheStore.getScheduleWindows();
      if (windows.length === 0) {
        return;
      }

      const nowMs = Date.now();
      const online = this.isOnline();

      for (const window of windows) {
        const unlockAtMs = new Date(window.unlock_at).getTime();
        const lockAtMs = new Date(window.lock_at).getTime();

        if (isNaN(unlockAtMs) || isNaN(lockAtMs)) continue;

        // Ignore windows that finished more than 30 minutes ago
        if (nowMs > lockAtMs + 30 * 60 * 1000) continue;
        // Ignore windows starting more than 2 hours in the future
        if (nowMs < unlockAtMs - 2 * 60 * 60 * 1000) continue;

        for (let i = 0; i < window.door_ids.length; i++) {
          const doorId = window.door_ids[i];
          const doorLabel = window.door_labels[i] || doorId;

          const timing = window.door_timings?.[doorId];
          const doorUnlockAtMs = timing ? new Date(timing.unlock_at).getTime() : unlockAtMs;
          const doorLockAtMs = timing ? new Date(timing.lock_at).getTime() : lockAtMs;

          if (isNaN(doorUnlockAtMs) || isNaN(doorLockAtMs)) continue;

          const unlockKey = `${window.id}:${doorId}:unlock`;
          const lockKey = `${window.id}:${doorId}:lock`;

          // 1. Check UNLOCK condition
          if (nowMs >= doorUnlockAtMs && nowMs < doorLockAtMs) {
            if (!cacheStore.hasExecutedAction(unlockKey)) {
              await this.executeUnlock(window, doorId, doorLabel, unlockKey, doorLockAtMs, nowMs, online);
            }
          }

          // 2. Check LOCK condition
          if (nowMs >= doorLockAtMs && nowMs < doorLockAtMs + 30 * 60 * 1000) {
            if (!cacheStore.hasExecutedAction(lockKey)) {
              await this.executeLock(window, doorId, doorLabel, lockKey, windows, nowMs, online);
            }
          }
        }
      }
    } catch (err) {
      logger.error(`[LocalScheduler] Error during schedule tick: ${String(err)}`);
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * Execute unlock via LAN API and record state.
   */
  private async executeUnlock(
    window: CachedScheduleWindow,
    doorId: string,
    doorLabel: string,
    unlockKey: string,
    lockAtMs: number,
    nowMs: number,
    online: boolean
  ): Promise<void> {
    const cacheStore = this.cacheStore;
    const durationMin = Math.max(1, Math.round((lockAtMs - nowMs) / (60 * 1000)));

    logger.info(
      `[LocalScheduler] 🔓 Triggering scheduled unlock: door "${doorLabel}" (${doorId}) ` +
        `for ${durationMin}m [Window: ${window.source_label}] (mode: ${online ? 'ONLINE' : 'OFFLINE_AUTONOMOUS'})`
    );

    let status: 'done' | 'failed' = 'done';
    let resultMessage = `Door unlocked for ${durationMin} minute(s) via LocalScheduler.`;

    try {
      await this.unifiClient.unlockDoor(doorId, durationMin);
      cacheStore.recordExecutedAction(unlockKey);
    } catch (err: any) {
      status = 'failed';
      resultMessage = `Unlock failed: ${err.message || String(err)}`;
      logger.error(`[LocalScheduler] Unlock failed for door ${doorId}: ${resultMessage}`);
      // Record executed anyway to avoid continuous crash loops on persistent errors
      cacheStore.recordExecutedAction(unlockKey);
    }

    if (online) {
      await this.reportActionOnline(window.id, doorId, doorLabel, 'unlock', status, resultMessage, durationMin);
    } else {
      const record: OfflineActionRecord = {
        id: crypto.randomUUID(),
        action: 'unlock',
        door_id: doorId,
        door_label: doorLabel,
        schedule_window_id: window.id,
        duration_min: durationMin,
        executed_at: new Date().toISOString(),
        status,
        result_message: resultMessage,
      };
      cacheStore.enqueueOfflineAction(record);
    }
  }

  /**
   * Execute lock via LAN API with local overlap protection.
   */
  private async executeLock(
    window: CachedScheduleWindow,
    doorId: string,
    doorLabel: string,
    lockKey: string,
    allWindows: CachedScheduleWindow[],
    nowMs: number,
    online: boolean
  ): Promise<void> {
    const cacheStore = this.cacheStore;

    // Overlap guard: Check if another window actively covers this door right now
    const hasActiveOverlappingWindow = allWindows.some((w) => {
      if (w.id === window.id) return false;
      if (!w.door_ids.includes(doorId)) return false;
      const timing = w.door_timings?.[doorId];
      const otherUnlockMs = timing ? new Date(timing.unlock_at).getTime() : new Date(w.unlock_at).getTime();
      const otherLockMs = timing ? new Date(timing.lock_at).getTime() : new Date(w.lock_at).getTime();
      return !isNaN(otherUnlockMs) && !isNaN(otherLockMs) && otherUnlockMs <= nowMs && otherLockMs > nowMs;
    });

    if (hasActiveOverlappingWindow) {
      logger.info(
        `[LocalScheduler] 🔒 Suppressed lock command for door "${doorLabel}" (${doorId}): ` +
          `another scheduled window is actively keeping this door unlocked.`
      );
      cacheStore.recordExecutedAction(lockKey);
      return;
    }

    logger.info(
      `[LocalScheduler] 🔒 Triggering scheduled lock: door "${doorLabel}" (${doorId}) ` +
        `[Window: ${window.source_label}] (mode: ${online ? 'ONLINE' : 'OFFLINE_AUTONOMOUS'})`
    );

    let status: 'done' | 'failed' = 'done';
    let resultMessage = 'Door locked successfully via LocalScheduler.';

    try {
      await this.unifiClient.lockDoor(doorId);
      cacheStore.recordExecutedAction(lockKey);
    } catch (err: any) {
      status = 'failed';
      resultMessage = `Lock failed: ${err.message || String(err)}`;
      logger.error(`[LocalScheduler] Lock failed for door ${doorId}: ${resultMessage}`);
      cacheStore.recordExecutedAction(lockKey);
    }

    if (online) {
      await this.reportActionOnline(window.id, doorId, doorLabel, 'lock', status, resultMessage);
    } else {
      const record: OfflineActionRecord = {
        id: crypto.randomUUID(),
        action: 'lock',
        door_id: doorId,
        door_label: doorLabel,
        schedule_window_id: window.id,
        executed_at: new Date().toISOString(),
        status,
        result_message: resultMessage,
      };
      cacheStore.enqueueOfflineAction(record);
    }
  }

  /**
   * Directly report action to Firestore when online.
   */
  private async reportActionOnline(
    windowId: string,
    doorId: string,
    doorLabel: string,
    action: 'unlock' | 'lock',
    status: 'done' | 'failed',
    resultMessage: string,
    durationMin?: number
  ): Promise<void> {
    try {
      const db = getDb();
      const now = admin.firestore.Timestamp.now();

      // 1. Audit Log
      await db.collection(`organizations/${this.orgId}/audit_log`).add({
        action,
        door_id: doorId,
        door_label: doorLabel,
        schedule_window_id: windowId,
        status,
        result: status === 'done' ? 'success' : 'error',
        result_message: resultMessage,
        message: resultMessage,
        triggered_by: 'local_scheduler',
        agent_id: this.agentId,
        org_id: this.orgId,
        timestamp: now,
      });

      // 2. Update Door Document
      const doorUpdate: Record<string, any> = {
        current_state: action === 'unlock' ? 'unlocked' : 'locked',
        last_synced: now,
      };
      if (action === 'unlock') {
        doorUpdate.last_unlocked_at = now;
        doorUpdate.is_held_unlocked = true;
        doorUpdate.unlock_trigger = 'scheduler';
        if (durationMin) {
          doorUpdate.unlock_duration_min = durationMin;
          doorUpdate.hold_unlock_expires_at = admin.firestore.Timestamp.fromMillis(Date.now() + durationMin * 60 * 1000);
        }
      } else {
        doorUpdate.last_locked_at = now;
        doorUpdate.is_held_unlocked = false;
        doorUpdate.hold_unlock_expires_at = null;
        doorUpdate.unlock_duration_min = null;
      }
      await db.doc(`organizations/${this.orgId}/doors/${doorId}`).set(doorUpdate, { merge: true });

      // 3. Update Window status
      const windowStatus = action === 'unlock'
        ? (status === 'done' ? 'unlocked' : 'unlock_failed')
        : (status === 'done' ? 'locked' : 'lock_failed');
      await db.doc(`organizations/${this.orgId}/schedule_windows/${windowId}`).update({
        status: windowStatus,
        last_updated: now,
      });
    } catch (err) {
      logger.warn(`[LocalScheduler] Online report notice: ${String(err)}`);
    }
  }

  /**
   * Get list of upcoming scheduled actions for the next 24-48 hours.
   */
  public getNextUpcomingActions(limit = 10): NextScheduledItem[] {
    const cacheStore = this.cacheStore;
    const windows = cacheStore.getScheduleWindows();
    const nowMs = Date.now();
    const items: NextScheduledItem[] = [];

    for (const w of windows) {
      for (let i = 0; i < w.door_ids.length; i++) {
        const doorId = w.door_ids[i];
        const doorLabel = w.door_labels[i] || doorId;

        const timing = w.door_timings?.[doorId];
        const unlockMs = timing ? new Date(timing.unlock_at).getTime() : new Date(w.unlock_at).getTime();
        const lockMs = timing ? new Date(timing.lock_at).getTime() : new Date(w.lock_at).getTime();
        const unlockIso = timing ? timing.unlock_at : w.unlock_at;
        const lockIso = timing ? timing.lock_at : w.lock_at;

        if (unlockMs > nowMs) {
          items.push({
            action: 'unlock',
            doorId,
            doorLabel,
            time: unlockIso,
            windowId: w.id,
            sourceLabel: w.source_label,
          });
        }
        if (lockMs > nowMs) {
          items.push({
            action: 'lock',
            doorId,
            doorLabel,
            time: lockIso,
            windowId: w.id,
            sourceLabel: w.source_label,
          });
        }
      }
    }

    items.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    return items.slice(0, limit);
  }
}
