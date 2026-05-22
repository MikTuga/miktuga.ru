# Release flow — выпуск новой версии Tuga app

Per-app release pipeline (manual для MVP; автоматизация через GitHub Action — Phase 2.x).

## Sequence

```
┌──────────────────────┐
│ 1. Bump version      │  В app/build.gradle.kts: versionName + versionCode++
│    + CHANGELOG       │  Описать что нового
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 2. Build release APK │  ./gradlew assembleRelease    (только TugaStore + TugaSettings)
│    apksigner verify  │  или дебаг (для community apps)
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 3. git tag + push    │  git tag -a vX.Y.Z -m "..."
│                      │  git push origin main vX.Y.Z
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 4. GitHub Release    │  gh release create vX.Y.Z --notes "..." app-release.apk
│    + APK attach      │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 5. Regenerate        │  cd miktuga.ru
│    manifest          │  node scripts/generate-manifest.js --with-hashes
│    + sign + publish  │  node scripts/sign-manifest.js
│                      │  git commit + push + wrangler pages deploy
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 6. (Phase 3+)        │  Tuga Store на устройствах увидит обновление в каталоге
│    OTA pickup        │  при следующем onResume с WiFi
└──────────────────────┘
```

## Per-app commands

### Bump version

В `<App>/app/build.gradle.kts`:

```kotlin
defaultConfig {
    versionCode = 4        // ← +1 каждый release
    versionName = "0.2.2"  // ← semver
}
```

В `<App>/CHANGELOG.md`:

```markdown
## [0.2.2] - 2026-XX-YY

### Added
- ...

### Fixed
- ...
```

### Build + verify (TugaStore / TugaSettings)

```bash
cd <App>
./gradlew clean assembleRelease

# Verify signing
apksigner verify --print-certs app/build/outputs/apk/release/*.apk
# должен показать SHA-1 06ebb7ac... — match с central keystore
```

### Tag + push

```bash
git add app/build.gradle.kts CHANGELOG.md
git commit -m "release: v0.2.2"
git push origin main
git tag -a v0.2.2 -m "Release v0.2.2"
git push origin v0.2.2
```

### GitHub Release с APK

```bash
gh release create v0.2.2 \
  --title "Tuga Store v0.2.2" \
  --notes-file CHANGELOG.md \
  app/build/outputs/apk/release/app-release.apk

# Или с явным renaming для consistency
cp app/build/outputs/apk/release/app-release.apk /tmp/tugastore-0.2.2.apk
gh release create v0.2.2 \
  --title "Tuga Store v0.2.2" \
  --notes "See CHANGELOG" \
  /tmp/tugastore-0.2.2.apk
```

### Regenerate manifest на miktuga.ru

```bash
cd <workspace>/miktuga.ru
node scripts/generate-manifest.js --with-hashes
node scripts/sign-manifest.js
node scripts/verify-manifest.js  # sanity check

git add public/api/
git commit -m "manifest: pickup TugaStore v0.2.2"
git push

wrangler pages deploy public --project-name miktuga --branch main
```

## Community apps (TugaOBD/GPS/Media/Sync)

Эти apps подписываются своим ключом, не central MikTuga keystore.

**Maintainer flow:**
1. Bump version + changelog (как central)
2. `./gradlew assembleRelease` — нужен свой `keystore.properties` + `.jks`
3. `gh release create vX.Y.Z --notes "..." app-release.apk`
4. Pull request в `miktuga.ru` repo: добавить новый release в manifest (или manual regenerate)

Manifest API сам подхватит свежий release при следующей regenerate.

## Auto-regenerate manifest (GitHub Action)

См. [`DEPLOYMENT.md`](DEPLOYMENT.md#с-github-action-опционально-автоматизация) — workflow тegirует все 6 GitHub repos и rebuild manifest каждые 6 часов.

## Checklist перед release

- [ ] versionCode > предыдущий (Android отвергнет downgrade)
- [ ] versionName в semver формате
- [ ] CHANGELOG entry создан
- [ ] Build success: `./gradlew assembleRelease`
- [ ] apksigner verify: cert SHA-1 матчит ожидаемый
- [ ] (для central apps) cert SHA-1 = `06ebb7ac36717017003232f471908c97d3407c1f`
- [ ] git tag pushed
- [ ] GitHub Release создан с APK asset
- [ ] manifest.json обновлён + signed + deployed
- [ ] (опционально) test on эмуляторе: install старой версии → обновить через TugaStore catalog (Phase 3)
