/**
 * firebase/updateChecker.ts
 * OTA (over-the-air) update checker for the local agent.
 *
 * On startup and on a configurable interval, checks Firestore for the latest
 * published agent release. If a newer version is available, downloads the
 * dist zip from the provided URL and stages it for application.
 *
 * The update is NOT auto-applied — the web UI surfaces it so the operator
 * can click "Apply Update", which calls applyPendingUpdate() and restarts.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { execSync } from 'child_process';
import * as os from 'os';
import * as admin from 'firebase-admin';
import { getDb } from '../firebase';
import { logger } from '../logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpdateState {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  changelog: string;
  downloadUrl: string | null;
  lastChecked: Date | null;
  applying: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Module-level state (read by web server)
// ---------------------------------------------------------------------------

function readCurrentVersion(): string {
  if (process.env.AGENT_VERSION) return process.env.AGENT_VERSION;
  if (process.env.npm_package_version) return process.env.npm_package_version;
  try {
    const candidates = [
      path.resolve(__dirname, '../../package.json'),
      path.resolve(__dirname, '../package.json'),
      path.resolve(process.cwd(), 'package.json'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (pkg.version) return pkg.version;
      }
    }
  } catch {}
  return '1.1.1';
}

let _state: UpdateState = {
  currentVersion: readCurrentVersion(),
  latestVersion: null,
  updateAvailable: false,
  changelog: '',
  downloadUrl: null,
  lastChecked: null,
  applying: false,
  error: null,
};

export function getUpdateState(): UpdateState {
  return { ..._state };
}

// ---------------------------------------------------------------------------
// Semver comparison
// ---------------------------------------------------------------------------

function parseVersion(v: string): [number, number, number] {
  const parts = String(v).replace(/^v/, '').split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function isNewer(candidate: string, current: string): boolean {
  const [cMaj, cMin, cPat] = parseVersion(candidate);
  const [eMaj, eMin, ePat] = parseVersion(current);
  if (cMaj !== eMaj) return cMaj > eMaj;
  if (cMin !== eMin) return cMin > eMin;
  return cPat > ePat;
}

// ---------------------------------------------------------------------------
// Check for update
// ---------------------------------------------------------------------------

export async function checkForUpdate(agentId?: string): Promise<UpdateState> {
  try {
    const db = getDb();
    const snap = await db.doc('agent_releases/latest').get();

    if (!snap.exists) {
      _state = { ..._state, latestVersion: null, updateAvailable: false, lastChecked: new Date(), error: null };
      if (agentId) {
        await db.doc(`agents/${agentId}`).set(
          {
            update_available: false,
            latest_version: _state.currentVersion,
            current_version: _state.currentVersion,
            update_checked_at: admin.firestore.Timestamp.now(),
          },
          { merge: true }
        ).catch(() => {});
      }
      return getUpdateState();
    }

    const data = snap.data()!;
    const latestVersion = String(data.version || '');
    const downloadUrl = String(data.download_url || '');
    const changelog = String(data.changelog || '');

    const updateAvailable = isNewer(latestVersion, _state.currentVersion);

    _state = {
      ..._state,
      latestVersion,
      updateAvailable,
      changelog,
      downloadUrl: updateAvailable ? downloadUrl : null,
      lastChecked: new Date(),
      error: null,
    };

    if (agentId) {
      await db.doc(`agents/${agentId}`).set(
        {
          update_available: updateAvailable,
          latest_version: latestVersion,
          current_version: _state.currentVersion,
          update_changelog: changelog,
          update_checked_at: admin.firestore.Timestamp.now(),
          update_status: updateAvailable ? (_state.applying ? 'applying' : 'idle') : 'idle',
        },
        { merge: true }
      ).catch(() => {});
    }

    if (updateAvailable) {
      logger.info(`[UpdateChecker] Update available: ${_state.currentVersion} → ${latestVersion}`);
    } else {
      logger.debug(`[UpdateChecker] Up to date (v${_state.currentVersion})`);
    }
  } catch (err) {
    const msg = String(err);
    logger.warn(`[UpdateChecker] Check failed: ${msg}`);
    _state = { ..._state, lastChecked: new Date(), error: msg };
  }

  return getUpdateState();
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith('https') ? https : http;
    const agent = new (require('https').Agent)({ rejectUnauthorized: false });

    protocol.get(url, { agent }, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync(destPath); } catch {}
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Apply pending update
// ---------------------------------------------------------------------------

export async function applyPendingUpdate(
  onRestart?: () => Promise<void>,
  agentId?: string
): Promise<void> {
  if (!_state.updateAvailable || !_state.downloadUrl) {
    throw new Error('No update available to apply.');
  }
  if (_state.applying) {
    throw new Error('Update is already being applied.');
  }

  _state = { ..._state, applying: true, error: null };
  const downloadUrl = _state.downloadUrl!;
  const targetVersion = _state.latestVersion!;

  logger.info(`[UpdateChecker] Applying update v${targetVersion} from ${downloadUrl}…`);

  if (agentId) {
    const db = getDb();
    await db.doc(`agents/${agentId}`).set(
      {
        update_status: 'downloading',
        update_error: null,
      },
      { merge: true }
    ).catch(() => {});
  }

  try {
    // 1. Create temp staging directory
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-update-'));
    const zipPath = path.join(tmpDir, 'dist.zip');
    const extractDir = path.join(tmpDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });

    // 2. Download zip
    logger.info(`[UpdateChecker] Downloading update zip…`);
    await downloadFile(downloadUrl, zipPath);
    logger.info(`[UpdateChecker] Download complete (${Math.round(fs.statSync(zipPath).size / 1024)} KB)`);

    if (agentId) {
      const db = getDb();
      await db.doc(`agents/${agentId}`).set(
        {
          update_status: 'applying',
        },
        { merge: true }
      ).catch(() => {});
    }

    // 3. Extract zip directly into dist directory
    const distDir = path.resolve(__dirname, '..');
    logger.info(`[UpdateChecker] Installing update directly to ${distDir}…`);
    execSync(`unzip -o "${zipPath}" -d "${distDir}"`, { stdio: 'pipe' });

    // 4. Update package.json version if found
    try {
      const candidates = [
        path.resolve(distDir, '../package.json'),
        path.resolve(distDir, '../../package.json'),
        path.resolve(process.cwd(), 'package.json'),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
          pkg.version = targetVersion;
          fs.writeFileSync(p, JSON.stringify(pkg, null, 2), 'utf-8');
        }
      }
    } catch {}

    // 5. Cleanup temp
    fs.rmSync(tmpDir, { recursive: true, force: true });

    logger.info(`[UpdateChecker] Update v${targetVersion} installed successfully. Restarting…`);
    _state = { ..._state, applying: false, currentVersion: targetVersion, updateAvailable: false };

    if (agentId) {
      const db = getDb();
      await db.doc(`agents/${agentId}`).set(
        {
          version: targetVersion,
          current_version: targetVersion,
          update_available: false,
          update_status: 'restarting',
          update_approved_version: null,
        },
        { merge: true }
      ).catch(() => {});
    }

    // 6. Restart
    if (onRestart) {
      await onRestart();
    } else {
      setTimeout(() => process.exit(0), 500);
    }
  } catch (err) {
    const msg = String(err);
    logger.error(`[UpdateChecker] Update failed: ${msg}`);
    _state = { ..._state, applying: false, error: msg };
    if (agentId) {
      const db = getDb();
      await db.doc(`agents/${agentId}`).set(
        {
          update_status: 'error',
          update_error: msg,
        },
        { merge: true }
      ).catch(() => {});
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Start periodic check interval & remote approval listener
// ---------------------------------------------------------------------------

export function startUpdateChecker(
  agentId?: string,
  orgId?: string,
  intervalMs: number = 60 * 1000,
  onRestart?: () => Promise<void>
): () => void {
  // Set current version from package.json
  try {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      _state.currentVersion = pkg.version || _state.currentVersion;
    }
  } catch {}

  logger.info(
    `[UpdateChecker] Starting — current version: v${_state.currentVersion}, poll interval: ${intervalMs / 1000}s`
  );

  // Check immediately on startup
  checkForUpdate(agentId).catch(() => {});

  // Periodic poll interval
  const handle = setInterval(() => {
    checkForUpdate(agentId).catch(() => {});
  }, intervalMs);

  let unsubSnapshot: (() => void) | null = null;

  // Real-time listener on agents/{agentId} for remote approval from app
  if (agentId) {
    try {
      const db = getDb();
      unsubSnapshot = db.doc(`agents/${agentId}`).onSnapshot(async (snap) => {
        if (!snap.exists) return;
        const data = snap.data();
        const approvedVersion = data?.update_approved_version;
        const autoUpdate = Boolean(data?.auto_update);

        // Ensure we have current release data
        if (!_state.latestVersion) {
          await checkForUpdate(agentId);
        }

        if (
          !_state.applying &&
          _state.updateAvailable &&
          _state.downloadUrl &&
          _state.latestVersion &&
          (approvedVersion === _state.latestVersion || autoUpdate) &&
          isNewer(_state.latestVersion, _state.currentVersion)
        ) {
          logger.info(
            `[UpdateChecker] 🚀 Auto-deploying approved update: v${_state.currentVersion} → v${_state.latestVersion}…`
          );
          try {
            await applyPendingUpdate(onRestart, agentId);
          } catch (err: any) {
            logger.error(`[UpdateChecker] Remote auto-deploy failed: ${err.message}`);
          }
        }
      });
    } catch (err: any) {
      logger.warn(`[UpdateChecker] Failed to attach agent document listener: ${err.message}`);
    }
  }

  if (handle.unref) handle.unref();

  return () => {
    clearInterval(handle);
    if (unsubSnapshot) unsubSnapshot();
    logger.info('[UpdateChecker] Stopped.');
  };
}
