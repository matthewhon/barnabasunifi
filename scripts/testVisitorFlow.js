const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
const fs = require('fs');

const possibleKeyPaths = [
  process.env.GOOGLE_APPLICATION_CREDENTIALS,
  path.join(__dirname, '../serviceAccountKey.json'),
  path.join(__dirname, '../service-account.json'),
  path.join(__dirname, '../functions/serviceAccountKey.json'),
];

const keyPath = possibleKeyPaths.find((p) => p && fs.existsSync(p));
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'barnabasunfi';

let app;
if (keyPath) {
  const serviceAccount = require(path.resolve(keyPath));
  app = initializeApp({
    credential: cert(serviceAccount),
    projectId,
  });
} else {
  app = initializeApp({
    projectId,
  });
}

const db = getFirestore(app);

async function main() {
  console.log('--- Checking Organizations ---');
  const orgsSnap = await db.collection('organizations').get();
  console.log(`Found ${orgsSnap.size} org(s).`);

  for (const orgDoc of orgsSnap.docs) {
    const orgId = orgDoc.id;
    const orgData = orgDoc.data();
    console.log(`\nOrg: ${orgId} (${orgData.name || 'unnamed'})`);

    // Check config
    const configSnap = await db.doc(`organizations/${orgId}/settings/config`).get();
    const config = configSnap.exists ? configSnap.data() : {};
    console.log(`Unifi Mode: ${config.unifi_mode || 'agent'}`);

    // Check visitors
    const visitorsSnap = await db.collection(`organizations/${orgId}/visitors`).get();
    console.log(`Total visitors in Firestore: ${visitorsSnap.size}`);
    visitorsSnap.docs.forEach((d) => {
      const v = d.data();
      console.log(` - Doc [${d.id}]: "${v.first_name} ${v.last_name || ''}" | Status: ${v.status} | Sync: ${v.sync_status} | unifi_visitor_id: ${v.unifi_visitor_id} | PIN: ${v.pin_code || 'none'}`);
    });

    // Check recent door commands
    const commandsSnap = await db.collection(`organizations/${orgId}/door_commands`)
      .orderBy('created_at', 'desc')
      .limit(10)
      .get();
    console.log(`Recent door commands (${commandsSnap.size}):`);
    commandsSnap.docs.forEach((c) => {
      const cd = c.data();
      console.log(` - [${c.id}] action=${cd.action} status=${cd.status} result=${cd.result || ''} error=${cd.error || ''} created_at=${cd.created_at}`);
      if (cd.visitor_data || cd.visitor_id) {
        console.log(`   data:`, JSON.stringify(cd.visitor_data || {}), `visitor_id:`, cd.visitor_id);
      }
    });

    // Check agent presence / heartbeat
    const agentSnap = await db.collection(`organizations/${orgId}/agent_status`).limit(5).get().catch(() => null);
    if (agentSnap && !agentSnap.empty) {
      agentSnap.docs.forEach((a) => {
        console.log(` Agent status [${a.id}]:`, a.data());
      });
    }
  }
}

main().catch((err) => {
  console.error('Error in test script:', err);
  process.exit(1);
});
