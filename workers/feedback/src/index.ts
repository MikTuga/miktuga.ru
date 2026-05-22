/**
 * Tuga Feedback API — Cloudflare Worker
 *
 *  Endpoints:
 *    POST /api/feedback   — accepts feedback JSON, stores in D1, returns 202
 *    OPTIONS *            — CORS preflight (for browser-form fallback)
 *
 *  Storage:    Cloudflare D1 (SQLite) — see schema.sql
 *  Notifications: Telegram bot (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars).
 *                 Skipped silently if not configured.
 *  Anti-spam: rate limit 5 req/hour per IP (in-memory KV), minimum body length 20 chars.
 *
 *  Threat model is LOW (low-volume hobby ecosystem). Worker validates schema, rejects
 *  obvious garbage, stores. Telegram is the human review surface.
 */

export interface Env {
  DB: D1Database;
  RATE_LIMIT: KVNamespace; // optional — bind `tuga-feedback-rate-limit` KV namespace
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

interface FeedbackPayload {
  app: string;
  version: string;
  type: 'bug' | 'idea' | 'question' | 'other';
  message: string;
  email?: string;
  diagnostic?: string;
  timestamp?: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const ALLOWED_PACKAGES = new Set([
  'com.miktuga.store',
  'com.miktuga.settings',
  'com.miktuga.obd',
  'com.miktuga.gps',
  'com.miktuga.media',
  'com.miktuga.sync',
]);

const ALLOWED_TYPES: FeedbackPayload['type'][] = ['bug', 'idea', 'question', 'other'];
const MAX_BODY_BYTES = 50 * 1024; // 50 KB hard cap

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname !== '/api/feedback') {
      return json({ error: 'not_found' }, 404);
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    // Size guard
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_BODY_BYTES) {
      return json({ error: 'payload_too_large', max_bytes: MAX_BODY_BYTES }, 413);
    }

    // Rate limit
    const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
    const overLimit = await checkRateLimit(env, clientIp);
    if (overLimit) {
      return json({ error: 'rate_limited', retry_after_seconds: 3600 }, 429);
    }

    // Parse + validate
    let body: FeedbackPayload;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }

    const validation = validate(body);
    if (validation.error) {
      return json({ error: 'validation_failed', detail: validation.error }, 400);
    }

    // Persist
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    try {
      await env.DB.prepare(
        `INSERT INTO feedback (id, created_at, app, version, type, message, email, diagnostic, ip)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
        .bind(
          id,
          createdAt,
          body.app,
          body.version,
          body.type,
          body.message,
          body.email || null,
          body.diagnostic ? body.diagnostic.slice(0, 10_000) : null,
          clientIp,
        )
        .run();
    } catch (e) {
      console.error('D1 insert failed', e);
      return json({ error: 'storage_failed' }, 500);
    }

    // Best-effort Telegram notification (don't block response)
    ctx.waitUntil(notifyTelegram(env, body, id, createdAt));

    return json({ id, accepted_at: createdAt }, 202);
  },
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function validate(p: FeedbackPayload): { error?: string } {
  if (!p || typeof p !== 'object') return { error: 'body_not_object' };
  if (!ALLOWED_PACKAGES.has(p.app)) return { error: 'unknown_app' };
  if (typeof p.version !== 'string' || !/^\d+\.\d+\.\d+/.test(p.version)) {
    return { error: 'invalid_version' };
  }
  if (!ALLOWED_TYPES.includes(p.type)) return { error: 'invalid_type' };
  if (typeof p.message !== 'string' || p.message.trim().length < 20) {
    return { error: 'message_too_short_min_20_chars' };
  }
  if (p.message.length > 5000) return { error: 'message_too_long_max_5000' };
  if (p.email !== undefined && p.email !== null && p.email !== '') {
    if (typeof p.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) {
      return { error: 'invalid_email' };
    }
    if (p.email.length > 200) return { error: 'email_too_long' };
  }
  return {};
}

async function checkRateLimit(env: Env, ip: string): Promise<boolean> {
  if (!env.RATE_LIMIT) return false; // KV not bound → skip rate limit
  const key = `rl:${ip}`;
  const raw = await env.RATE_LIMIT.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= 5) return true;
  await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 3600 });
  return false;
}

async function notifyTelegram(env: Env, body: FeedbackPayload, id: string, createdAt: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const text = [
    `📨 *Tuga feedback* [${body.type}]`,
    `*App:* \`${body.app}\` v${body.version}`,
    body.email ? `*From:* ${escapeMd(body.email)}` : '*From:* anonymous',
    '',
    escapeMd(body.message.slice(0, 1200)),
    body.message.length > 1200 ? `\n_(truncated, full ${body.message.length} chars)_` : '',
    '',
    `_${createdAt}_ · id: \`${id.slice(0, 8)}\``,
  ].join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) console.error(`telegram notify failed: ${res.status} ${await res.text()}`);
  } catch (e) {
    console.error('telegram notify exception', e);
  }
}

function escapeMd(s: string): string {
  return s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
