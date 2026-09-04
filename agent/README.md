# UnFi-PCO Local Agent

## Overview

The Local Agent is a lightweight Node.js process that runs **on-premises** at each church. It acts as the bridge between the Firebase cloud platform and the local [UniFi Access](https://ui.com/door-access) API:

```
Firebase Firestore  ←─── Cloud ───→  Local Agent  ←─── LAN ───→  UniFi Console
  (door_commands)                    (this service)               (door hardware)
```

The agent:
- **Listens** in real-time for door commands queued in Firestore
- **Executes** unlock/lock commands against the local UniFi Access API
- **Syncs** door states back into Firestore so the dashboard stays current
- **Heartbeats** to Firestore so admins can monitor agent health from anywhere

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Docker & Docker Compose** | Install from [docs.docker.com](https://docs.docker.com/get-docker/) |
| **UniFi Console access** | Must be on the same local network as this machine |
| **UniFi Access API Token** | See [Obtaining an API Token](#obtaining-a-unifi-access-api-token) below |
| **Firebase Service Account** | Provided by your org admin from the app **Settings → Agent** page |

---

## Obtaining a UniFi Access API Token

1. Log in to your **UniFi Access** application (via the UniFi OS portal)
2. Navigate to **Settings → General**
3. Under **Developer API**, enable the API and copy the **API Token**

> [!IMPORTANT]
> Keep this token secret — it grants full control over all doors on the console.

---

## Quick Setup (Zero-Touch Cloud Pairing — Recommended)

With the UnFi-PCO cloud dashboard, there is no need to manually copy service account JSON keys or configure local `.env` files.

### 1. Configure UniFi in the Web Dashboard
1. Go to your dashboard: **Settings → UniFi Controller Connection**.
2. Select **Option A: On-Premises Local Agent**.
3. Paste your **UniFi Access Developer API Token**.
4. *(Optional)* Enter your local UniFi Console IP (e.g. `https://192.168.1.1`). If left blank, the Docker container will automatically scan your local network to find it.
5. Click **Save UniFi Credentials to Cloud**, then click **Generate Connection Token**.

### 2. Run the Docker Container
On any machine on your church's local network (server, mini-PC, or Raspberry Pi), run:

```bash
docker run -d \
  --name unifi-pco-agent \
  --restart unless-stopped \
  --network host \
  -e CONNECTION_TOKEN=UPCO_ey... \
  unifi-pco-agent
```

*(Replace `UPCO_ey...` with your token copied from the dashboard.)*

The container will automatically:
1. Contact the cloud pairing endpoint and authenticate with your organization.
2. Pull down your UniFi Access token.
3. Auto-discover the UniFi console on the local network (if host was left blank or changed).
4. Synchronize your doors with Firestore and begin listening for unlock/lock schedules!

---

## Alternative: Interactive Web Portal

If you prefer to configure the agent via a browser on the local machine:

1. Run `START_AGENT.bat` (Windows) or `docker compose up -d`.
2. Open your browser to **`http://localhost:8080`**.
3. Paste your **Connection Token**, click **Scan Subnet** (or enter your console IP), and click **Connect & Register**.

---

## Alternative: Manual Environment File Setup (.env)

If running in an isolated environment without connection tokens:

### 1. Copy the example environment file
```bash
cp .env.example .env
```

### 2. Fill in `.env`
```env
# IP or hostname of your UniFi console (include https://)
UNIFI_HOST=https://192.168.1.1

# API token from UniFi Access > Settings > General > Developer API
UNIFI_ACCESS_TOKEN=your-token-here

# Firebase project — do not change
FIREBASE_PROJECT_ID=barnabasunfi

# Org ID and Agent ID
ORG_ID=your-org-id
AGENT_ID=agent-main-campus
AGENT_LABEL=Main Campus Agent
```

### 3. Start the agent
```bash
docker compose up -d
```

The agent will:
1. Connect to the UniFi console
2. Register itself in Firestore
3. Sync door states
4. Begin listening for commands

### 6. Check logs

```bash
docker compose logs -f
```

You should see output like:
```
[2024-01-15 10:30:00] [INFO] Firebase initialized for project: barnabasunfi
[2024-01-15 10:30:01] [INFO] UniFi connection OK — host: https://192.168.1.1
[2024-01-15 10:30:01] [INFO] [DoorSync] Synced 4 door(s) for org: my-org
[2024-01-15 10:30:01] [INFO] ✓ Agent running — listening for door commands.
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `UNIFI_HOST` | ✅ | — | Full URL of UniFi console, e.g. `https://192.168.1.1` |
| `UNIFI_ACCESS_TOKEN` | ✅ | — | Bearer token for the UniFi Access Developer API |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | ✅ | — | Path to the service account JSON file |
| `FIREBASE_PROJECT_ID` | ✅ | — | Firebase project ID (`barnabasunfi`) |
| `ORG_ID` | ✅ | — | Your organization's Firestore document ID |
| `AGENT_ID` | ✅ | — | Unique ID for this agent instance (e.g. `agent-main-campus`) |
| `AGENT_LABEL` | ❌ | `Unnamed Agent` | Display name shown in the dashboard |
| `HEARTBEAT_INTERVAL_MS` | ❌ | `60000` | How often (ms) to write a heartbeat to Firestore |
| `DOOR_SYNC_INTERVAL_MS` | ❌ | `300000` | How often (ms) to sync door states from UniFi |
| `SKIP_TLS_VERIFY` | ❌ | `false` | Set `true` to disable TLS cert validation (self-signed certs) |
| `LOG_LEVEL` | ❌ | `info` | Logging verbosity: `error`, `warn`, `info`, `debug` |

---

## Updating the Agent

```bash
# Pull latest code
git pull

# Rebuild and restart
docker compose up -d --build
```

---

## Troubleshooting

### TLS / SSL certificate errors

**Symptom:** `Error: self-signed certificate` or `UNABLE_TO_VERIFY_LEAF_SIGNATURE`

**Fix:** Set `SKIP_TLS_VERIFY=true` in your `.env`. This is expected when the UniFi console uses its default self-signed certificate.

> [!WARNING]
> `SKIP_TLS_VERIFY=true` disables certificate validation. Only use this on trusted local networks.

---

### Authentication failures (401 Unauthorized)

**Symptom:** `UniFi API error [401]`

**Fix:**
1. Verify `UNIFI_ACCESS_TOKEN` is correct
2. Check that the token hasn't expired or been regenerated in the UniFi console
3. Ensure the API is enabled in **UniFi Access → Settings → General**

---

### Connection refused / timeout

**Symptom:** `ECONNREFUSED` or `ETIMEDOUT`

**Fix:**
1. Confirm `UNIFI_HOST` is reachable from the machine running the agent:
   ```bash
   curl -k https://192.168.1.1/api/v1/developer/doors
   ```
2. Verify the agent machine is on the same LAN as the UniFi console
3. Check that `network_mode: host` is set in `docker-compose.yml`

---

### Firebase permission errors

**Symptom:** `PERMISSION_DENIED` in logs

**Fix:**
1. Confirm `service-account.json` belongs to the correct Firebase project
2. Verify the service account has Firestore read/write permissions
3. Check Firestore Security Rules allow the agent's service account

---

### Agent shows offline in dashboard

**Symptom:** Dashboard shows agent as offline even though it's running

**Fix:**
1. Check `docker compose logs -f` for heartbeat errors
2. Verify `ORG_ID` and `AGENT_ID` match what's configured in the app Settings
3. Confirm the service account has write access to the `agents/` collection

---

## Running Without Docker

If you prefer to run the agent directly with Node.js:

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run
npm start
```

For development with hot-reload:
```bash
npm run dev
```

---

## Architecture Notes

- **Multi-agent safe**: Commands are claimed atomically using Firestore transactions, so multiple agents can run concurrently for multi-campus deployments without duplicate execution.
- **Offline resilience**: The agent reconnects automatically if the Firestore listener drops. Door sync continues independently of command execution.
- **Audit trail**: Every command execution (success or failure) is written to `/organizations/{orgId}/audit_log` for compliance and debugging.
