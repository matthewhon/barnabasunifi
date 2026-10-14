/**
 * scripts/packageDockerAgent.js
 * Builds and packages the complete Docker Agent installer into a zip archive
 * for users to download from the website.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const agentDir = path.join(rootDir, 'agent');
  const appDir = path.join(rootDir, 'app');
  const downloadsDir = path.join(appDir, 'public', 'downloads');

  const pkg = JSON.parse(fs.readFileSync(path.join(agentDir, 'package.json'), 'utf-8'));
  const version = pkg.version;

  console.log(`\n📦 Packaging Docker Agent v${version} for website download…`);

  // 1. Build agent TypeScript code
  console.log('1. Compiling agent TypeScript…');
  execSync('npm run build', { cwd: agentDir, stdio: 'inherit' });

  // 2. Ensure destination directory exists
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }

  // Ensure service-account.json placeholder exists
  const dummySaPath = path.join(agentDir, 'service-account.json');
  if (!fs.existsSync(dummySaPath)) {
    fs.writeFileSync(dummySaPath, '{}\n', 'utf-8');
  }

  // 3. Package into zip archive
  const genericZipName = 'unifi-pco-agent.zip';
  const versionedZipName = `unifi-pco-agent-v${version}.zip`;
  const appZipPath = path.join(downloadsDir, genericZipName);
  const appVersionedZipPath = path.join(downloadsDir, versionedZipName);
  const agentZipPath = path.join(agentDir, versionedZipName);

  // Files to include in the package
  const filesToInclude = [
    'Dockerfile',
    'docker-compose.yml',
    'START_AGENT.bat',
    'start_agent.sh',
    'WINDOWS_README.txt',
    'README.md',
    '.env.example',
    'package.json',
    'tsconfig.json',
    'service-account.json',
    'src',
    'dist'
  ];

  console.log(`2. Creating zip archive containing Docker installer files…`);
  // Remove existing zip if any
  if (fs.existsSync(appZipPath)) fs.unlinkSync(appZipPath);

  // Use zip command with exclusion of unnecessary files
  const fileArgs = filesToInclude.map(f => `"${f}"`).join(' ');
  execSync(`zip -r "${appZipPath}" ${fileArgs} -x "*.DS_Store*" "*node_modules*" "*.git*"`, {
    cwd: agentDir,
    stdio: 'pipe',
  });

  // Copy to versioned files
  fs.copyFileSync(appZipPath, appVersionedZipPath);
  fs.copyFileSync(appZipPath, agentZipPath);

  const stats = fs.statSync(appZipPath);
  const sizeKb = (stats.size / 1024).toFixed(1);

  console.log(`\n🎉 SUCCESS! Docker Agent package created:`);
  console.log(`   - File: ${appZipPath} (${sizeKb} KB)`);
  console.log(`   - Versioned: ${appVersionedZipPath}`);
  console.log(`   - Public download URL: /downloads/${genericZipName}`);
  console.log(`   - Also available at: /downloads/${versionedZipName}`);
}

main().catch((err) => {
  console.error('\n❌ Packaging failed:', err);
  process.exit(1);
});
