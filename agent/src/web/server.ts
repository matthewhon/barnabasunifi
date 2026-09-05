/**
 * server.ts
 * Embedded Express Web Server for Agent Configuration & Management.
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { logger, getRecentLogs } from '../logger';
import { getConfigurationStatus, saveConfig, isServiceAccountPresent } from '../config';
import axios from 'axios';
import { scanSubnet } from './scanner';
import { UnifiAccessClient } from '../unifi/access';
import { getUpdateState, checkForUpdate, applyPendingUpdate } from '../firebase/updateChecker';

export interface AgentBridgeState {
  status: 'unconfigured' | 'starting' | 'running' | 'error';
  unifiConnected: boolean;
  firebaseConnected: boolean;
  doorCount: number;
  lastSync: Date | null;
  errorMessage?: string;
  onRestartRequest?: () => Promise<void>;
  onSyncDoors?: () => Promise<number>;
}

export function startWebServer(
  port: number,
  state: AgentBridgeState
): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

  // Resolve public directory for HTML assets
  const publicDirCandidates = [
    path.join(__dirname, 'public'),
    path.join(__dirname, '../../src/web/public'),
    path.join(process.cwd(), 'src/web/public'),
    path.join(process.cwd(), 'dist/web/public'),
  ];
  let publicDir = publicDirCandidates[0];
  for (const dir of publicDirCandidates) {
    if (fs.existsSync(dir)) {
      publicDir = dir;
      break;
    }
  }

  // Serve static UI
  app.use(express.static(publicDir));
  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // GET /api/status
  app.get('/api/status', (_req, res) => {
    const configStatus = getConfigurationStatus();
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './service-account.json';
    const saPresent = isServiceAccountPresent(serviceAccountPath);

    res.json({
      status: state.status,
      unifiConnected: state.unifiConnected,
      firebaseConnected: state.firebaseConnected,
      serviceAccountPresent: saPresent,
      doorCount: state.doorCount,
      lastSync: state.lastSync ? state.lastSync.toISOString() : null,
      error: state.errorMessage,
      ...(() => {
        const upd = getUpdateState();
        return {
          version: upd.currentVersion,
          latestVersion: upd.latestVersion,
          updateAvailable: upd.updateAvailable,
          updateChangelog: upd.changelog,
        };
      })(),
      config: configStatus.config
        ? {
            unifiHost: configStatus.config.unifiHost,
            unifiAccessToken: configStatus.config.unifiAccessToken || '',
            orgId: configStatus.config.orgId,
            agentId: configStatus.config.agentId,
            agentLabel: configStatus.config.agentLabel,
            firebaseProjectId: configStatus.config.firebaseProjectId,
            skipTlsVerify: configStatus.config.skipTlsVerify,
          }
        : {
            unifiHost: process.env.UNIFI_HOST || '',
            unifiAccessToken: process.env.UNIFI_ACCESS_TOKEN || '',
            orgId: process.env.ORG_ID || '',
            agentId: process.env.AGENT_ID || 'agent-main-campus',
            agentLabel: process.env.AGENT_LABEL || 'Main Campus Agent',
            firebaseProjectId: process.env.FIREBASE_PROJECT_ID || 'barnabasunfi',
            skipTlsVerify: process.env.SKIP_TLS_VERIFY !== 'false',
          },
      missing: configStatus.missing,
    });
  });

  // GET /api/logs
  app.get('/api/logs', (_req, res) => {
    res.json({ logs: getRecentLogs() });
  });

  // POST /api/scan-unifi
  app.post('/api/scan-unifi', async (req, res) => {
    const subnet = req.body?.subnet || '192.168.1';
    logger.info(`[WebUI] Scanning subnet ${subnet}.0/24 for UniFi consoles…`);
    try {
      const consoles = await scanSubnet(subnet);
      logger.info(`[WebUI] Scan complete — found ${consoles.length} candidate(s).`);
      res.json({ consoles });
    } catch (err: any) {
      logger.error(`[WebUI] Subnet scan failed: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/test-unifi
  app.post('/api/test-unifi', async (req, res) => {
    const { host, token, skipTls } = req.body || {};
    if (!host) {
      res.status(400).json({ ok: false, error: 'Host is required' });
      return;
    }

    try {
      const client = new UnifiAccessClient(host, token || '', Boolean(skipTls));
      const connected = await client.testConnection();
      if (!connected) {
        res.json({ ok: false, error: 'Could not connect to host. Check IP or self-signed cert setting.' });
        return;
      }

      const doors = await client.getDoors();
      res.json({
        ok: true,
        doorCount: doors.length,
        doors: doors.map((d) => ({ id: d.id, name: d.name, status: d.door_lock_relay_status })),
      });
    } catch (err: any) {
      res.json({ ok: false, error: err.message });
    }
  });

  // POST /api/upload-service-account
  app.post('/api/upload-service-account', upload.single('serviceAccount'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ ok: false, error: 'No file uploaded' });
      return;
    }

    try {
      const content = req.file.buffer.toString('utf-8');
      const parsed = JSON.parse(content);
      if (!parsed.project_id || !parsed.private_key) {
        res.status(400).json({ ok: false, error: 'Invalid service account JSON: missing project_id or private_key' });
        return;
      }

      const targetPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './service-account.json');
      fs.writeFileSync(targetPath, content, 'utf-8');
      logger.info(`[WebUI] Service account key saved successfully to ${targetPath} (project: ${parsed.project_id})`);

      res.json({ ok: true, projectId: parsed.project_id });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: `Invalid JSON file: ${err.message}` });
    }
  });

  // POST /api/register-token
  app.post('/api/register-token', async (req, res) => {
    const { token, agentId, label, unifiHost } = req.body || {};
    if (!token || typeof token !== 'string') {
      res.status(400).json({ ok: false, error: 'Connection token is required.' });
      return;
    }

    try {
      // Decode token to inspect payload
      const base64Str = token.replace(/^UPCO_/, '').trim();
      const raw = Buffer.from(base64Str, 'base64').toString('utf-8');
      const parsed = JSON.parse(raw);
      const endpoint =
        parsed.endpoint ||
        `https://us-central1-${parsed.projectId || 'barnabasunfi'}.cloudfunctions.net/registerAgentWithToken`;

      logger.info(`[WebUI] Registering agent with cloud endpoint: ${endpoint} for org: ${parsed.orgId}…`);

      // Call cloud function
      const response = await axios.post(
        endpoint,
        {
          token,
          agentId: agentId || process.env.AGENT_ID || 'agent-main-campus',
          label: label || process.env.AGENT_LABEL || 'Main Campus Agent',
          unifiHost: unifiHost || process.env.UNIFI_HOST || '',
          version: process.env.npm_package_version || '1.0.0',
        },
        { timeout: 15000 }
      );

      if (response.data?.ok) {
        const { orgId, customToken, projectId, unifiHost: returnedHost, unifiAccessToken, skipTlsVerify } = response.data;
        // Save to config
        saveConfig({
          ORG_ID: orgId,
          FIREBASE_PROJECT_ID: projectId || 'barnabasunfi',
          AGENT_ID: agentId || process.env.AGENT_ID || 'agent-main-campus',
          AGENT_LABEL: label || process.env.AGENT_LABEL || 'Main Campus Agent',
          AGENT_AUTH_TOKEN: customToken,
          CONNECTION_TOKEN: token,
          ...(returnedHost ? { UNIFI_HOST: returnedHost } : {}),
          ...(unifiAccessToken ? { UNIFI_ACCESS_TOKEN: unifiAccessToken } : {}),
          ...(skipTlsVerify !== undefined ? { SKIP_TLS_VERIFY: String(skipTlsVerify) } : {}),
        });

        logger.info(`[WebUI] Successfully registered and associated with organization: ${orgId}!`);

        if (state.onRestartRequest) {
          await state.onRestartRequest();
        }

        res.json({
          ok: true,
          orgId,
          agentId: agentId || process.env.AGENT_ID || 'agent-main-campus',
          agentLabel: label || process.env.AGENT_LABEL || 'Main Campus Agent',
          unifiHost: returnedHost || unifiHost,
          unifiAccessToken: unifiAccessToken || '',
          skipTlsVerify: skipTlsVerify ?? true,
          projectId: projectId || 'barnabasunfi',
          message: 'Agent registered and linked successfully! Credentials pulled from cloud.',
        });
      } else {
        res.status(400).json({ ok: false, error: response.data?.error || 'Registration failed' });
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message;
      logger.error(`[WebUI] Registration handshake error: ${msg}`);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // GET /api/version — returns version info and update status
  app.get('/api/version', (_req, res) => {
    const upd = getUpdateState();
    res.json({
      currentVersion: upd.currentVersion,
      latestVersion: upd.latestVersion,
      updateAvailable: upd.updateAvailable,
      changelog: upd.changelog,
      lastChecked: upd.lastChecked?.toISOString() ?? null,
      applying: upd.applying,
      error: upd.error,
    });
  });

  // POST /api/check-update — manually trigger an update check
  app.post('/api/check-update', async (_req, res) => {
    logger.info('[WebUI] Manual update check triggered.');
    try {
      const result = await checkForUpdate();
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/apply-update — download and apply pending update, then restart
  app.post('/api/apply-update', async (_req, res) => {
    const upd = getUpdateState();
    if (!upd.updateAvailable) {
      res.status(400).json({ ok: false, error: 'No update available.' });
      return;
    }
    if (upd.applying) {
      res.status(409).json({ ok: false, error: 'Update is already in progress.' });
      return;
    }
    logger.info('[WebUI] Apply update requested.');
    res.json({ ok: true, message: `Downloading and applying v${upd.latestVersion}… Agent will restart.` });
    // Apply asynchronously after responding
    setTimeout(() => {
      applyPendingUpdate(state.onRestartRequest).catch((err) => {
        logger.error(`[WebUI] Apply update failed: ${err.message}`);
      });
    }, 100);
  });

  // POST /api/sync-doors — force door discovery sync
  app.post('/api/sync-doors', async (_req, res) => {
    logger.info('[WebUI] Manual door sync requested.');
    if (!state.onSyncDoors) {
      res.status(503).json({ ok: false, error: 'Door sync handler not initialized or agent offline.' });
      return;
    }
    try {
      const count = await state.onSyncDoors();
      res.json({ ok: true, count, message: `Discovered and synced ${count} door(s).` });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/save-config

  app.post('/api/save-config', async (req, res) => {
    const updates = req.body || {};
    // Don't wipe existing UNIFI_ACCESS_TOKEN if empty string was submitted
    if (updates.UNIFI_ACCESS_TOKEN === '' && (process.env.UNIFI_ACCESS_TOKEN || '').trim()) {
      delete updates.UNIFI_ACCESS_TOKEN;
    }
    try {
      saveConfig(updates);
      logger.info('[WebUI] Configuration updated via Web UI.');

      if (state.onRestartRequest) {
        await state.onRestartRequest();
      }

      res.json({ ok: true });
    } catch (err: any) {
      logger.error(`[WebUI] Failed to save configuration: ${err.message}`);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/restart — trigger a bridge restart
  app.post('/api/restart', async (_req, res) => {
    logger.info('[WebUI] Restart requested via API.');
    res.json({ ok: true, message: 'Restarting agent…' });
    if (state.onRestartRequest) {
      setTimeout(() => state.onRestartRequest!(), 500);
    }
  });

  // POST /api/update-agent — upload a zip of new dist JS files and restart
  // Accepts multipart form with field "update" containing a zip file
  const updateUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
  app.post('/api/update-agent', updateUpload.single('update'), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ ok: false, error: 'No file uploaded. POST multipart with field "update" containing a zip.' });
      return;
    }

    try {
      const { execSync } = await import('child_process');
      const os = await import('os');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-update-'));
      const zipPath = path.join(tmpDir, 'update.zip');
      fs.writeFileSync(zipPath, req.file.buffer);

      // Determine dist directory (where the running code lives)
      const distDir = path.resolve(__dirname, '..');
      logger.info(`[WebUI] Applying update to dist at ${distDir}…`);
      execSync(`unzip -o "${zipPath}" -d "${distDir}"`, { stdio: 'pipe' });
      fs.rmSync(tmpDir, { recursive: true, force: true });

      logger.info('[WebUI] Agent update applied successfully. Restarting…');
      res.json({ ok: true, message: 'Update applied. Agent restarting…' });

      if (state.onRestartRequest) {
        setTimeout(() => state.onRestartRequest!(), 500);
      }
    } catch (err: any) {
      logger.error(`[WebUI] Update failed: ${err.message}`);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.listen(port, '0.0.0.0', () => {
    logger.info(`🌐 Web Configuration Portal running at http://localhost:${port}`);
  });

  return app;
}

