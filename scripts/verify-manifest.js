#!/usr/bin/env node
/**
 * Verify public/api/manifest.json against public/api/manifest.json.sig using public key.
 *
 * Sanity check before publishing. Mirrors what TugaStore's ManifestVerifier will do
 * on-device (Phase 3): Ed25519 signature verify, abort OTA if invalid.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MANIFEST_PATH = path.resolve(__dirname, '..', 'public', 'api', 'manifest.json');
const SIG_PATH = MANIFEST_PATH + '.sig';
const PUBLIC_PATH = path.resolve(__dirname, '..', 'keys', 'public.pem');

for (const p of [MANIFEST_PATH, SIG_PATH, PUBLIC_PATH]) {
  if (!fs.existsSync(p)) {
    console.error(`✗ ${p} not found`);
    process.exit(1);
  }
}

const manifest = fs.readFileSync(MANIFEST_PATH);
const sigHex = fs.readFileSync(SIG_PATH, 'utf8').trim();
const sigBuf = Buffer.from(sigHex, 'hex');
const publicPem = fs.readFileSync(PUBLIC_PATH);
const publicKey = crypto.createPublicKey(publicPem);

const ok = crypto.verify(null, manifest, publicKey, sigBuf);

if (ok) {
  const data = JSON.parse(manifest);
  console.log('✓ Signature VALID');
  console.log(`  Manifest version ${data.version}, generated ${data.generated_at}`);
  console.log(`  ${data.apps.length} apps:`);
  for (const a of data.apps) {
    console.log(`    - ${a.name} v${a.versionName} (${a.package})`);
  }
  process.exit(0);
} else {
  console.error('✗ Signature INVALID. Do not publish this manifest.');
  process.exit(2);
}
