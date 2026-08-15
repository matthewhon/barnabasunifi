# UnFi-PCO

A multi-tenant platform that automatically manages UniFi Access door schedules based on Planning Center Online (Services + Groups) event schedules.

## Architecture

```
Cloud (Firebase)                    On-Premises (per church)
─────────────────────               ─────────────────────────
Next.js Dashboard (App Hosting)     Local Agent (Docker)
Firebase Auth (multi-tenant)   ←→  UniFi Access API
Firestore (data store)              
Cloud Functions (PCO polling,       
  scheduling, OAuth)
```

## Monorepo Structure

```
.
├── app/          # Next.js 15 web dashboard (Firebase App Hosting)
├── functions/    # Firebase Cloud Functions (PCO sync, scheduling, auth)
├── agent/        # Local on-prem agent (Docker, bridges Firestore ↔ UniFi)
├── shared/       # Shared TypeScript types
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
└── apphosting.yaml
```

## Quick Start

### Prerequisites
- Node.js 20+
- Firebase CLI: `npx -y firebase-tools@latest --version`
- A Firebase project (this app uses `barnabasunfi`)

### Development Setup

```bash
# Install all workspace dependencies
npm install

# Start Next.js dev server
npm run dev

# Start Cloud Functions emulator
cd functions && npm run build && cd ..
npx -y firebase-tools@latest emulators:start --only auth,firestore,functions
```

### Deploy

```bash
# Deploy Firestore rules + indexes
npx -y firebase-tools@latest deploy --only firestore

# Deploy Firebase Auth config
npx -y firebase-tools@latest deploy --only auth

# Deploy Cloud Functions
npx -y firebase-tools@latest deploy --only functions

# Deploy web app (via App Hosting — git push triggers auto-deploy)
npx -y firebase-tools@latest deploy --only apphosting
```

## User Roles

| Role | Description |
|------|-------------|
| `super_admin` | Full platform access across all orgs |
| `org_admin` | Full access to their organization |
| `manager` | View + manual door overrides |
| `viewer` | Read-only |

## Planning Center Setup

1. Create an OAuth app at https://api.planningcenteronline.com/oauth/applications
2. Set redirect URI to `https://us-central1-barnabasunfi.cloudfunctions.net/pcoOAuthCallback`
3. Add `PCO_CLIENT_ID` and `PCO_CLIENT_SECRET` to Firebase App Hosting secrets
4. Each org connects their PCO account via **Settings → Connect Planning Center**

## Local Agent Setup

See [agent/README.md](./agent/README.md) for complete setup instructions.

Each church campus runs one agent on a local server or Raspberry Pi.

## Environment Variables

### App (`app/.env.local`)
See `app/.env.example`

### Cloud Functions
Set via Firebase App Hosting secrets:
- `PCO_CLIENT_ID` — Planning Center OAuth app client ID
- `PCO_CLIENT_SECRET` — Planning Center OAuth app client secret

### Agent (`agent/.env`)
See `agent/.env.example`
