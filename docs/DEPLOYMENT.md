# Deployment guide — miktuga.ru

End-to-end: купить домен → DNS → Cloudflare Pages (лендинг + manifest) → Cloudflare Worker (feedback API). Один раз, ~1 час.

## Что получим

| Endpoint | Источник | Содержит |
|---|---|---|
| `https://miktuga.ru/` | Cloudflare Pages (`public/index.html`) | Лендинг |
| `https://miktuga.ru/api/manifest.json` | Cloudflare Pages (static, signed) | Список последних версий 6 апок |
| `https://miktuga.ru/api/manifest.json.sig` | Cloudflare Pages (static) | Ed25519 подпись |
| `https://miktuga.ru/api/feedback` | Cloudflare Worker (`workers/feedback/`) | POST endpoint, D1 storage, Telegram notify |

## Prerequisites

- Аккаунт на Cloudflare (бесплатный)
- Купленный домен `miktuga.ru` (любой регистратор — `reg.ru`, `namecheap`, и т.д.)
- Node.js 18+ локально
- `wrangler` CLI: `npm install -g wrangler` или через `npx`

---

## 1. Домен → Cloudflare DNS

1. Зарегистрировать `miktuga.ru` через любого регистратора (~₽500/год).
2. В Cloudflare dashboard → **Websites** → **Add a site** → ввести `miktuga.ru` → выбрать **Free** plan.
3. Cloudflare покажет 2 nameservers (например `kim.ns.cloudflare.com` + `walt.ns.cloudflare.com`).
4. В админке регистратора заменить дефолтные NS на эти два. Активация занимает 5 минут — 24 часа.
5. Проверка: `dig NS miktuga.ru` должен вернуть Cloudflare nameservers.

---

## 2. Cloudflare Pages (лендинг + статический manifest)

```bash
# В корне репо
cd miktuga.ru

# Login (откроется браузер)
wrangler login

# Deploy public/ как Cloudflare Pages проект "miktuga"
wrangler pages deploy public --project-name miktuga --branch main
```

Первый раз: создаст Pages проект, выдаст URL вида `https://miktuga.pages.dev`.

### Привязать к домену

Cloudflare dashboard → **Workers & Pages** → `miktuga` проект → **Custom domains** → **Set up a custom domain** → ввести `miktuga.ru` → подтвердить.

Cloudflare автоматически добавит CNAME запись и выдаст SSL-сертификат.

Через 2-5 минут `https://miktuga.ru/` будет показывать лендинг.

### Обновление лендинга

```bash
# После изменений в public/
wrangler pages deploy public --project-name miktuga --branch main
```

Или подключить repo к Pages для auto-deploy на push (через UI).

---

## 3. Ed25519 keys для manifest подписи

**Первый раз, делается ОДНОКРАТНО на жизнь проекта.**

```bash
node scripts/generate-keys.js
```

Выведет:
- `keys/private.pem` — **СОХРАНИ в encrypted vault** (Bitwarden Send, 1Password, GPG-encrypted USB). Этот файл gitignored. Если его потеряешь — OTA pipeline мёртв навсегда.
- `keys/public.pem` — коммитится в репо
- `keys/public.hex` — копируется в TugaStore `ManifestVerifier.kt` (Phase 3, когда придёт время)

**Бэкап:**
```bash
# Encrypted с GPG (или используй Bitwarden Send / 1Password)
gpg --symmetric --cipher-algo AES256 keys/private.pem
# → keys/private.pem.gpg

# Загрузить в Bitwarden Send / iCloud / физический USB
```

**Что делать если private.pem утерян:**
1. Сгенерировать новую пару (`node scripts/generate-keys.js`)
2. Обновить pinned public hex в TugaStore source + bump TugaStore version
3. Релизить новый TugaStore — все юзеры должны обновиться (через USB!) прежде чем смогут продолжать получать OTA
4. До этого момента все OTA-обновления через старый ключ будут отвергнуты на устройстве

---

## 4. Генерация manifest

```bash
# Один раз в начале — создать api/ директорию
mkdir -p public/api

# Сборка manifest из последних releases на GitHub
node scripts/generate-manifest.js

# С computed SHA-256 (медленнее — скачивает APK):
node scripts/generate-manifest.js --with-hashes

# Подписать
node scripts/sign-manifest.js

# Проверить (без публикации)
node scripts/verify-manifest.js

# Запушить (manifest коммитится в репо, попадает на Pages при следующем deploy)
git add public/api/
git commit -m "manifest: update for v0.X.Y"
git push
wrangler pages deploy public --project-name miktuga --branch main
```

### С GitHub Action (опционально, автоматизация)

`.github/workflows/manifest.yml` — на каждый release любого Tuga app:

```yaml
name: Rebuild manifest
on:
  workflow_dispatch:
  schedule:
    - cron: '0 */6 * * *'  # каждые 6 часов
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - name: Generate manifest
        run: node scripts/generate-manifest.js --with-hashes
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Restore private key
        run: echo "${{ secrets.ED25519_PRIVATE_PEM }}" > keys/private.pem
      - name: Sign
        run: node scripts/sign-manifest.js
      - name: Commit
        run: |
          git config user.name "miktuga-bot"
          git config user.email "noreply@miktuga.ru"
          git add public/api/
          git diff --cached --quiet || (git commit -m "manifest: auto-rebuild" && git push)
      - name: Deploy
        run: npx wrangler pages deploy public --project-name miktuga --branch main
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

Secrets to add в GitHub repo Settings:
- `ED25519_PRIVATE_PEM` — содержимое `keys/private.pem` (целиком, с newlines)
- `CLOUDFLARE_API_TOKEN` — Cloudflare API token с permissions Pages + Account read

---

## 5. Feedback Worker (D1 + KV + Telegram)

```bash
cd workers/feedback
npm install

# Create D1 database
npx wrangler d1 create tuga-feedback
# → выведет database_id, скопировать в wrangler.toml (`database_id = "..."`)

# Apply schema
npx wrangler d1 execute tuga-feedback --file schema.sql --remote

# Create rate-limit KV
npx wrangler kv namespace create tuga-feedback-rate-limit
# → выведет id, скопировать в wrangler.toml (`id = "..."`)

# Telegram notifications (опционально)
# Сначала: создай бота через @BotFather → получи token
# Затем: добавь бота в группу или личку → получи chat_id через https://api.telegram.org/bot<TOKEN>/getUpdates
npx wrangler secret put TELEGRAM_BOT_TOKEN   # → вставить token
npx wrangler secret put TELEGRAM_CHAT_ID     # → вставить chat_id

# Deploy
npx wrangler deploy
# → выведет URL вида https://tuga-feedback.<account>.workers.dev
```

### Привязать `miktuga.ru/api/feedback` к Worker

Cloudflare dashboard → **Workers & Pages** → `tuga-feedback` → **Settings** → **Triggers** → **Add Custom Domain** → ввести `miktuga.ru/api/feedback`.

Или через wrangler.toml routes (раскомментировать секцию + `wrangler deploy`).

### Test

```bash
curl -X POST https://miktuga.ru/api/feedback \
  -H 'Content-Type: application/json' \
  -d '{"app":"com.miktuga.store","version":"0.2.1","type":"bug","message":"тестовый отчёт минимум 20 символов","email":"test@example.com"}'
# → {"id":"...", "accepted_at":"..."}
```

Проверить D1:
```bash
npx wrangler d1 execute tuga-feedback --command "SELECT id, created_at, app, type, substr(message,1,50) FROM feedback ORDER BY created_at DESC LIMIT 5"
```

---

## 6. Smoke test после полного деплоя

| Что проверить | Команда |
|---|---|
| Лендинг открывается | `curl -I https://miktuga.ru/` → `200 OK` |
| Manifest читается | `curl https://miktuga.ru/api/manifest.json \| jq .apps[].name` |
| Signature accessible | `curl -I https://miktuga.ru/api/manifest.json.sig` → `200 OK` |
| Manifest signature валидна | Скачать оба + `node scripts/verify-manifest.js` (с public.pem) |
| Feedback endpoint жив | `curl -X POST https://miktuga.ru/api/feedback -H 'Content-Type: application/json' -d '{...}'` → `202` |
| Telegram notification | Прислать тестовое сообщение, проверить что бот написал в чат |

---

## Costs

| Сервис | План | Цена |
|---|---|---|
| Домен miktuga.ru | базовая регистрация | ~₽500/год |
| Cloudflare Pages | Free (unlimited bandwidth до Pro limits) | ₽0 |
| Cloudflare Worker | Free (100k req/day) | ₽0 |
| Cloudflare D1 | Free (5 GB) | ₽0 |
| Cloudflare KV | Free (100k reads/day) | ₽0 |

Итого: **~₽500/год** (только домен).

Если разогнать Worker > 100k req/day или D1 > 5 GB — придётся апгрейдиться на Workers Paid ($5/мес).
