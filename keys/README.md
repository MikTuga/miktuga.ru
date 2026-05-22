# keys/

Ed25519 keypair for signing OTA manifest.

## Files

- **`private.pem`** — GITIGNORED. Generated locally by `node ../scripts/generate-keys.js`.
  **Back up immediately to encrypted vault** (Bitwarden Send / 1Password / GPG-encrypted USB).
  Loss of private.pem = loss of OTA pipeline ability. See `../docs/DEPLOYMENT.md`.

- **`public.pem`** — Committed. PEM-format public key for sanity checks via `verify-manifest.js`.

- **`public.hex`** — Committed. Raw 32-byte Ed25519 public key (hex-encoded). This is what gets
  pinned in `TugaStore/app/src/main/java/com/miktuga/store/ManifestVerifier.kt` as a `const val`
  (Phase 3, when OTA-client lands).

## Rotation

Don't rotate unless private.pem is compromised — rotation invalidates every shipped TugaStore.

If you must rotate:
1. `node scripts/generate-keys.js` (will refuse to overwrite — manually rm old files first)
2. Update pinned hex in TugaStore source
3. Release TugaStore with new key
4. **Until users update via USB, their OTA channel is dead** — old TugaStore can't verify new signatures

## Backup checklist

- [ ] Bitwarden Send / 1Password / GPG-encrypted USB
- [ ] Verify backup readable (decrypt + diff with original)
- [ ] Store backup in physically different location than main copy
- [ ] Document recovery procedure in your personal notes (NOT in this repo)
