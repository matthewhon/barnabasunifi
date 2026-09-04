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

export interface AgentBridgeState {
  status: 'unconfigured' | 'starting' | 'running' | 'error';
  unifiConnected: boolean;
  firebaseConnected: boolean;
  doorCount: number;
  lastSync: Date | null;
  errorMessage?: string;
  onRestartRequest?: () => Promise<void>;
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
      config: configStatus.config
        ? {
            unifiHost: configStatus.config.unifiHost,
            orgId: configStatus.config.orgId,
            agentId: configStatus.config.agentId,
            agentLabel: configStatus.config.agentLabel,
            firebaseProjectId: configStatus.config.firebaseProjectId,
            skipTlsVerify: configStatus.config.skipTlsVerify,
          }
        : {
            unifiHost: process.env.UNIFI_HOST || '',
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
        const { orgId, customToken, projectId } = response.data;
        // Save to .env
        saveConfig({
          ORG_ID: orgId,
          FIREBASE_PROJECT_ID: projectId || 'barnabasunfi',
          AGENT_ID: agentId || process.env.AGENT_ID || 'agent-main-campus',
          AGENT_LABEL: label || process.env.AGENT_LABEL || 'Main Campus Agent',
          AGENT_AUTH_TOKEN: customToken,
          CONNECTION_TOKEN: token,
        });

        logger.info(`[WebUI] Successfully registered and associated with organization: ${orgId}!`);

        if (state.onRestartRequest) {
          await state.onRestartRequest();
        }

        res.json({ ok: true, orgId, message: 'Agent registered and linked successfully!' });
      } else {
        res.status(400).json({ ok: false, error: response.data?.error || 'Registration failed' });
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message;
      logger.error(`[WebUI] Registration handshake error: ${msg}`);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // POST /api/save-config
  app.post('/api/save-config', async (req, res) => {
    const updates = req.body || {};
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

  app.listen(port, '0.0.0.0', () => {
    logger.info(`🌐 Web Configuration Portal running at http://localhost:${port}`);
  });

  return app;
}
