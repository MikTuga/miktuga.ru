-- Tuga feedback storage (Cloudflare D1 / SQLite)
-- Apply via: wrangler d1 execute tuga-feedback --file workers/feedback/schema.sql

CREATE TABLE IF NOT EXISTS feedback (
  id          TEXT PRIMARY KEY,             -- crypto.randomUUID()
  created_at  TEXT NOT NULL,                 -- ISO 8601 UTC
  app         TEXT NOT NULL,                 -- com.miktuga.{store,settings,obd,gps,media,sync}
  version     TEXT NOT NULL,                 -- semver of the app reporting
  type        TEXT NOT NULL CHECK (type IN ('bug', 'idea', 'question', 'other')),
  message     TEXT NOT NULL,                 -- 20..5000 chars
  email       TEXT,                          -- optional, validated regex
  diagnostic  TEXT,                          -- truncated to 10K chars in Worker
  ip          TEXT,                          -- cf-connecting-ip, for ban + rate limit forensics
  read_at     TEXT,                          -- nullable, set when maintainer marks as read
  replied_at  TEXT                           -- nullable
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback (created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_app        ON feedback (app);
CREATE INDEX IF NOT EXISTS idx_feedback_type       ON feedback (type);
CREATE INDEX IF NOT EXISTS idx_feedback_unread     ON feedback (created_at) WHERE read_at IS NULL;
