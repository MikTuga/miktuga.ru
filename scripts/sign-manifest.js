#!/usr/bin/env node
/**
 * Sign public/api/manifest.json with Ed25519 private key.
 *
 *  Input:   public/api/manifest.json     (output of generate-manifest.js)
 *           keys/private.pem              (output of generate-keys.js)
 *  Output:  public/api/manifest.json.sig  (raw 64-byte signature, hex-encoded)
 *
 * The Tuga Store client verifies this signature against the public key pinned in
 * its source code. If the signature is invalid OR public key doesn't match → abort
 * the OTA flow. Manifest tampering or MitM is detected here.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MANIFEST_PATH = path.resolve(__dirname, '..', 'public', 'api', 'manifest.json');
const SIG_PATH = MANIFEST_PATH + '.sig';
const PRIVATE_PATH = path.resolve(__dirname, '..', 'keys', 'private.pem');

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error(`✗ ${MANIFEST_PATH} not found. Run generate-manifest.js first.`);
  process.exit(1);
}
if (!fs.existsSync(PRIVATE_PATH)) {
  console.error(`✗ ${PRIVATE_PATH} not found. Run generate-keys.js first.`);
  console.error('  (Or restore private.pem from your encrypted backup.)');
  process.exit(1);
}

const manifest = fs.readFileSync(MANIFEST_PATH);
const privatePem = fs.readFileSync(PRIVATE_PATH);
const privateKey = crypto.createPrivateKey(privatePem);

// Ed25519 in Node.js: signature is over the raw bytes, no extra hashing.
const sigBuf = crypto.sign(null, manifest, privateKey);
const sigHex = sigBuf.toString('hex');

fs.writeFileSync(SIG_PATH, sigHex + '\n');

console.log('✓ Manifest signed');
console.log(`  ${MANIFEST_PATH} (${manifest.length} bytes)`);
console.log(`  ${SIG_PATH} (${sigBuf.length} bytes signature, hex-encoded)`);
console.log('');
console.log('Verify with: node scripts/verify-manifest.js');
