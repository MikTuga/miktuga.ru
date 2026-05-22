# miktuga.ru

Лендинг + OTA-инфраструктура для [Tuga ecosystem](https://github.com/MikTuga) — приложений на головы Geely Tugella (Android 5.1).

## Что внутри

```
miktuga.ru/
├── public/                 ← Cloudflare Pages target (статика + manifest)
│   ├── index.html          Лендинг
│   ├── styles.css
│   ├── favicon.svg
│   └── api/
│       ├── manifest.json   Список последних версий 6 апок (generated)
│       └── manifest.json.sig   Ed25519 signature (generated)
│
├── workers/
│   └── feedback/           Cloudflare Worker: /api/feedback (POST, D1, Telegram)
│       ├── src/index.ts
│       ├── wrangler.toml
│       └── schema.sql      D1 schema
│
├── scripts/
│   ├── generate-keys.js    Ed25519 keypair (один раз на жизнь проекта)
│   ├── generate-manifest.js   GitHub API → manifest.json
│   ├── sign-manifest.js    private.pem → manifest.json.sig
│   └── verify-manifest.js  Sanity check
│
├── keys/
│   ├── public.pem          Pinned в TugaStore (Phase 3)
│   ├── public.hex          Hex для Kotlin const
│   └── private.pem         (GITIGNORED — back up to encrypted vault)
│
└── docs/
    ├── DEPLOYMENT.md       Step-by-step setup (домен, CF Pages, CF Worker)
    └── RELEASE_FLOW.md     Per-app release pipeline
```

## Stack

- **Лендинг:** plain HTML/CSS, без build step (Cloudflare Pages, free tier)
- **Manifest:** static JSON + Ed25519 signature, rebuilt offline после каждого app release
- **Feedback API:** Cloudflare Worker (TypeScript) + D1 (SQLite) + KV (rate limit) + Telegram (notify)

Total cost: **~₽500/год** (только домен; всё остальное на CF free tier).

## Quick start (для maintainer'а)

```bash
# 1. Сгенерировать Ed25519 ключи (один раз)
node scripts/generate-keys.js
# → keys/private.pem (backup it!) + keys/public.pem + keys/public.hex

# 2. Build manifest from GitHub releases
node scripts/generate-manifest.js --with-hashes
node scripts/sign-manifest.js
node scripts/verify-manifest.js  # sanity check

# 3. Preview лендинга локально
cd public && python3 -m http.server 8000
# → http://localhost:8000

# 4. Deploy (после Cloudflare setup, см. docs/DEPLOYMENT.md)
wrangler pages deploy public --project-name miktuga --branch main
cd workers/feedback && wrangler deploy
```

## API contracts

### GET `/api/manifest.json`

Список последних версий всех 6 апок:

```json
{
  "version": 1,
  "generated_at": "2026-05-23T...Z",
  "ecosystem": "miktuga/tuga",
  "apps": [
    {
      "package": "com.miktuga.store",
      "name": "Tuga Store",
      "repo": "MikTuga/tugastore",
      "central": true,
      "versionName": "0.2.1",
      "tag": "v0.2.1",
      "minSdk": 22,
      "url": "https://github.com/.../tugastore-release.apk",
      "sha256": "...",
      "size": 4995229,
      "releasedAt": "2026-05-22T...Z",
      "changelog": "..."
    }
  ]
}
```

### GET `/api/manifest.json.sig`

Hex-encoded Ed25519 signature (64 bytes) over the manifest.json bytes.

### POST `/api/feedback`

```json
{
  "app": "com.miktuga.store",
  "version": "0.2.1",
  "type": "bug",
  "message": "Минимум 20 символов",
  "email": "user@example.com",      // опционально
  "diagnostic": "..."               // опционально, до 10K chars
}
```

Response: `202 { "id": "...", "accepted_at": "..." }`.

Errors:
- `400 validation_failed`
- `413 payload_too_large`
- `429 rate_limited`

## Compliance

- Unofficial. Не аффилирован с Geely Auto Group.
- "Geely", "Tugella" — товарные знаки Geely Auto Group.
- Весь код — MIT.

## Roadmap

- **v0.1 (текущее)** — лендинг + signed manifest static + feedback API
- **v0.2** — GitHub Action для auto-rebuild manifest на каждый release
- **v0.3** — crash reporting endpoint (`/api/crash`), Sentry-lite
- **v0.4** — analytics dashboard (read-only D1 query view для maintainer'а)
