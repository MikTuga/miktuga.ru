#!/usr/bin/env node
/**
 * Generate Ed25519 keypair for signing the OTA manifest.
 *
 *  Private key → keys/private.pem  (GITIGNORED — MUST stay offline)
 *  Public key  → keys/public.pem   (committed; also exported as hex for TugaStore source)
 *  Public hex  → keys/public.hex   (32 raw bytes hex; copy into TugaStore ManifestVerifier)
 *
 * Run ONCE per ecosystem. Backup private.pem to a hardware token or encrypted vault.
 * If you ever lose the private key, the OTA pipeline is dead (every install rejects
 * signatures from new keys) until you ship a new pinned public key in TugaStore.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const KEYS_DIR = path.resolve(__dirname, '..', 'keys');
const PRIVATE_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_PATH = path.join(KEYS_DIR, 'public.pem');
const PUBLIC_HEX_PATH = path.join(KEYS_DIR, 'public.hex');

if (fs.existsSync(PRIVATE_PATH)) {
  console.error(`✗ ${PRIVATE_PATH} already exists. Refusing to overwrite.`);
  console.error('  Remove it manually if you really want to rotate keys (this invalidates every');
  console.error('  shipped TugaStore that has the old public key pinned).');
  process.exit(1);
}

fs.mkdirSync(KEYS_DIR, { recursive: true });

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });

// Extract raw 32-byte Ed25519 public key from SPKI DER (last 32 bytes).
const pubDer = publicKey.export({ type: 'spki', format: 'der' });
const rawPub = pubDer.slice(pubDer.length - 32);
const pubHex = rawPub.toString('hex');

fs.writeFileSync(PRIVATE_PATH, privPem, { mode: 0o600 });
fs.writeFileSync(PUBLIC_PATH, pubPem, { mode: 0o644 });
fs.writeFileSync(PUBLIC_HEX_PATH, pubHex + '\n', { mode: 0o644 });

console.log('✓ Ed25519 keypair generated');
console.log(`  Private (PKCS8 PEM):  ${PRIVATE_PATH}  [chmod 600, GITIGNORED]`);
console.log(`  Public  (SPKI PEM):   ${PUBLIC_PATH}`);
console.log(`  Public  (raw hex):    ${PUBLIC_HEX_PATH}`);
console.log('');
console.log('Pin this in TugaStore source (ManifestVerifier.kt):');
console.log(`  private const val MANIFEST_PUBLIC_KEY_HEX = "${pubHex}"`);
console.log('');
console.log('NEXT STEPS:');
console.log('  1. Back up private.pem to encrypted vault (Bitwarden Send / 1Password / GPG-encrypted USB)');
console.log('  2. Verify backup before deleting any local copy');
console.log('  3. Pin the public hex above in TugaStore ManifestVerifier (will land in Phase 3)');
