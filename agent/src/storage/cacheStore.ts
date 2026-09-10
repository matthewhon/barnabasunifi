/**
 * storage/cacheStore.ts
 * Local persistent cache for offline resilience.
 *
 * Persists organization settings, door inventory, upcoming schedule windows,
 * and pending offline action records to disk (data/offline_cache.json).
 * Uses atomic writes (write-to-temp then rename) to prevent corruption.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger';

export interface CachedSettings {
  timezone: string;
  unlock_buffer_before_min: number;
  lock_buffer_after_min: number;
  lock_timing_mode: 'after_end' | 'after_start';
  lock_after_start_min: number;
  unifi_host?: string;
  unifi_access_token?: string;
  unifi_api_key?: string;
}

export interface CachedDoor {
  id: string;
  name: string;
  unifi_door_id: string;
  current_state: 'locked' | 'unlocked' | 'unknown';
  is_held_unlocked?: boolean;
}

export interface CachedScheduleWindowDoorTiming {
  unlock_at: string;
  lock_at: string;
  unlock_offset_min?: number;
  lock_offset_min?: number;
  lock_timing_mode?: 'after_end' | 'after_start';
}

export interface CachedScheduleWindow {
  id: string;
  org_id: string;
  source_label: string;
  starts_at: string;
  ends_at: string;
  unlock_at: string;
  lock_at: string;
  lock_timing_mode?: 'after_end' | 'after_start';
  door_ids: string[];
  door_labels: string[];
  door_timings?: Record<string, CachedScheduleWindowDoorTiming>;
  status: 'pending' | 'unlocked' | 'locked' | 'cancelled' | 'error' | string;
}

export interface OfflineActionRecord {
  id: string;
  action: 'unlock' | 'lock';
  door_id: string;
  door_label: string;
  schedule_window_id: string;
  duration_min?: number;
  executed_at: string;
  status: 'done' | 'failed';
  result_message: string;
}

export interface OfflineCacheData {
  version: number;
  org_id: string;
  last_sync: string | null;
  settings: CachedSettings;
  doors: CachedDoor[];
  schedule_windows: CachedScheduleWindow[];
  offline_actions: OfflineActionRecord[];
  /** Keys in the form "windowId:doorId:action" to prevent double-firing */
  executed_action_keys: string[];
}

const DEFAULT_CACHE: OfflineCacheData = {
  version: 1,
  org_id: '',
  last_sync: null,
  settings: {
    timezone: 'UTC',
    unlock_buffer_before_min: 15,
    lock_buffer_after_min: 15,
    lock_timing_mode: 'after_end',
    lock_after_start_min: 15,
  },
  doors: [],
  schedule_windows: [],
  offline_actions: [],
  executed_action_keys: [],
};

export class CacheStore {
  private cacheFilePath: string;
  private memoryCache: OfflineCacheData;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(customPath?: string) {
    if (customPath) {
      this.cacheFilePath = path.resolve(customPath);
    } else {
      const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
      this.cacheFilePath = path.join(dataDir, 'offline_cache.json');
    }
    this.memoryCache = { ...DEFAULT_CACHE };
    this.ensureDirectoryExists();
    this.loadFromDisk();
  }

  private ensureDirectoryExists(): void {
    const dir = path.dirname(this.cacheFilePath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (err) {
      logger.warn(`[CacheStore] Could not create cache directory ${dir}: ${String(err)}`);
    }
  }

  /**
   * Load cache from disk into memory.
   */
  public loadFromDisk(): OfflineCacheData {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = fs.readFileSync(this.cacheFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<OfflineCacheData>;
        this.memoryCache = {
          version: parsed.version || 1,
          org_id: parsed.org_id || '',
          last_sync: parsed.last_sync || null,
          settings: { ...DEFAULT_CACHE.settings, ...(parsed.settings || {}) },
          doors: Array.isArray(parsed.doors) ? parsed.doors : [],
          schedule_windows: Array.isArray(parsed.schedule_windows) ? parsed.schedule_windows : [],
          offline_actions: Array.isArray(parsed.offline_actions) ? parsed.offline_actions : [],
          executed_action_keys: Array.isArray(parsed.executed_action_keys) ? parsed.executed_action_keys : [],
        };
        logger.debug(`[CacheStore] Loaded cache from disk: ${this.memoryCache.schedule_windows.length} windows, ${this.memoryCache.doors.length} doors.`);
      }
    } catch (err) {
      logger.error(`[CacheStore] Failed to parse cache file at ${this.cacheFilePath}: ${String(err)}`);
    }
    return this.memoryCache;
  }

  /**
   * Atomically save the memory cache to disk.
   */
  public saveToDiskSync(): void {
    try {
      this.ensureDirectoryExists();
      const tmpPath = `${this.cacheFilePath}.${Date.now()}.tmp`;
      const dataStr = JSON.stringify(this.memoryCache, null, 2);
      fs.writeFileSync(tmpPath, dataStr, 'utf-8');
      fs.renameSync(tmpPath, this.cacheFilePath);
    } catch (err) {
      logger.error(`[CacheStore] Failed to write cache to ${this.cacheFilePath}: ${String(err)}`);
    }
  }

  /**
   * Debounced save to reduce frequent disk I/O.
   */
  public scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.saveToDiskSync();
    }, 1000);
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  public getCache(): OfflineCacheData {
    return this.memoryCache;
  }

  public getSettings(): CachedSettings {
    return this.memoryCache.settings;
  }

  public getDoors(): CachedDoor[] {
    return this.memoryCache.doors;
  }

  public getScheduleWindows(): CachedScheduleWindow[] {
    return this.memoryCache.schedule_windows;
  }

  public getPendingOfflineActions(): OfflineActionRecord[] {
    return this.memoryCache.offline_actions;
  }

  public hasExecutedAction(key: string): boolean {
    return this.memoryCache.executed_action_keys.includes(key);
  }

  // ---------------------------------------------------------------------------
  // Setters & Mutators
  // ---------------------------------------------------------------------------

  public setOrgId(orgId: string): void {
    if (this.memoryCache.org_id !== orgId) {
      this.memoryCache.org_id = orgId;
      this.scheduleSave();
    }
  }

  public updateSettings(updates: Partial<CachedSettings>): void {
    this.memoryCache.settings = {
      ...this.memoryCache.settings,
      ...updates,
    };
    this.scheduleSave();
  }

  public updateDoors(doors: CachedDoor[]): void {
    this.memoryCache.doors = doors;
    this.scheduleSave();
  }

  public updateScheduleWindows(windows: CachedScheduleWindow[]): void {
    this.memoryCache.schedule_windows = windows;
    this.memoryCache.last_sync = new Date().toISOString();
    this.pruneOldExecutedKeys();
    this.scheduleSave();
  }

  public recordExecutedAction(key: string): void {
    if (!this.memoryCache.executed_action_keys.includes(key)) {
      this.memoryCache.executed_action_keys.push(key);
      this.scheduleSave();
    }
  }

  public enqueueOfflineAction(action: OfflineActionRecord): void {
    this.memoryCache.offline_actions.push(action);
    this.saveToDiskSync(); // Always flush offline actions immediately for durability
  }

  public clearFlushedOfflineActions(actionIds: string[]): void {
    if (actionIds.length === 0) return;
    const idsSet = new Set(actionIds);
    this.memoryCache.offline_actions = this.memoryCache.offline_actions.filter((a) => !idsSet.has(a.id));
    this.saveToDiskSync();
  }

  /**
   * Prunes executed keys older than the windows currently stored
   * to keep the key list bounded.
   */
  private pruneOldExecutedKeys(): void {
    const validWindowIds = new Set(this.memoryCache.schedule_windows.map((w) => w.id));
    this.memoryCache.executed_action_keys = this.memoryCache.executed_action_keys.filter((k) => {
      const parts = k.split(':');
      const windowId = parts[0];
      return validWindowIds.has(windowId);
    });
  }

  /**
   * Checks if valid cache exists on disk.
   */
  public static hasExistingCache(customPath?: string): boolean {
    const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
    const p = customPath || path.join(dataDir, 'offline_cache.json');
    if (!fs.existsSync(p)) return false;
    try {
      const stat = fs.statSync(p);
      return stat.size > 10;
    } catch {
      return false;
    }
  }
}

// Global default instance
let globalCacheStore: CacheStore | null = null;

export function getCacheStore(): CacheStore {
  if (!globalCacheStore) {
    globalCacheStore = new CacheStore();
  }
  return globalCacheStore;
}
