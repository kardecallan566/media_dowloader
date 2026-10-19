-- Phase 2: monthly Stripe subscriptions and server-checked entitlements.
-- Run after 0001_orders.sql. Old one-time orders remain archival.
CREATE TABLE IF NOT EXISTS subscriptions (
 subscription_id TEXT PRIMARY KEY,
 customer_id TEXT NOT NULL,
 checkout_session_id TEXT UNIQUE,
 email TEXT,
 status TEXT NOT NULL CHECK(status IN
   ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),
 period_end INTEGER NOT NULL DEFAULT 0,
 cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK(cancel_at_period_end IN (0,1)),
 price_id TEXT NOT NULL,
 license_hash TEXT UNIQUE NOT NULL,
 license_revoked INTEGER NOT NULL DEFAULT 0 CHECK(license_revoked IN (0,1)),
 last_event_created INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mfp_subscription_customer ON subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_mfp_subscription_status ON subscriptions(status, period_end);
CREATE TABLE IF NOT EXISTS subscription_events (
 event_id TEXT PRIMARY KEY,
 subscription_id TEXT NOT NULL,
 received_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mfp_subscription_events_subscription ON subscription_events(subscription_id);
CREATE TABLE IF NOT EXISTS subscription_devices (
 subscription_id TEXT NOT NULL REFERENCES subscriptions(subscription_id) ON DELETE CASCADE,
 device_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 last_seen INTEGER NOT NULL DEFAULT (unixepoch()),
 PRIMARY KEY (subscription_id,device_hash)
);
