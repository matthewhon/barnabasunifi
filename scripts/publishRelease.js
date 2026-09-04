/**
 * scripts/publishRelease.js
 * Builds, packages, and publishes the latest agent release to Firebase.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const agentDir = path.join(rootDir, 'agent');
  const pkg = JSON.parse(fs.readFileSync(path.join(agentDir, 'package.json'), 'utf-8'));
  const version = pkg.version;

  console.log(`\n📦 Preparing agent release v${version}…`);

  // 1. Build agent
  console.log('1. Building agent…');
  execSync('npm run build', { cwd: agentDir, stdio: 'inherit' });

  // 2. Package into zip
  const zipName = `agent-v${version}.zip`;
  const zipPath = path.join(agentDir, zipName);
  console.log(`2. Packaging dist into ${zipName}…`);
  execSync(`cd "${path.join(agentDir, 'dist')}" && zip -r "${zipPath}" .`, { stdio: 'pipe' });

  const zipBuffer = fs.readFileSync(zipPath);
  console.log(`   Zip created: ${(zipBuffer.length / 1024).toFixed(1)} KB`);

  // 3. Upload to Cloud Function
  const changelog = process.argv[2] || `UniFi credential auto-population, token visibility toggle, and stability improvements`;
  const endpoint = `https://us-central1-barnabasunfi.cloudfunctions.net/uploadAgentRelease`;
  console.log(`3. Uploading to ${endpoint}…`);

  const payload = JSON.stringify({
    version,
    zipBase64: zipBuffer.toString('base64'),
    changelog,
    secret: process.env.RELEASE_SECRET || 'UPCO_AGENT_OTA_2026',
  });

  const url = new URL(endpoint);
  const options = {
    hostname: url.hostname,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (d) => { body += d; });
    res.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.ok) {
          console.log(`\n🎉 SUCCESS! Agent v${version} published to Firebase.`);
          console.log(`   Download URL: ${data.downloadUrl}`);
          console.log(`   The running agent will now detect this update!`);
        } else {
          console.error(`\n❌ Publish failed:`, data.error);
        }
      } catch (e) {
        console.error(`\n❌ Error parsing response (${res.statusCode}):`, body);
      }
    });
  });

  req.on('error', (e) => {
    console.error(`\n❌ Request error:`, e.message);
  });

  req.write(payload);
  req.end();
}

main().catch(console.error);
