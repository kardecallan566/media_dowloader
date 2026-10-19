-- Media Finder Pro storefront orders. Run against a D1 database bound as DB.
-- Checkout sessions are unique and Stripe event IDs prevent duplicate event identities.
CREATE TABLE IF NOT EXISTS orders (
  session_id TEXT PRIMARY KEY,
  payment_intent TEXT,
  email TEXT,
  amount_total INTEGER,
  currency TEXT,
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','paid','failed','expired','refunded')),
  fulfillment_status TEXT NOT NULL DEFAULT 'not_configured'
    CHECK (fulfillment_status IN ('not_configured','pending','delivered','revoked')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mfp_orders_payment_intent ON orders(payment_intent);
CREATE INDEX IF NOT EXISTS idx_mfp_orders_status ON orders(payment_status);
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  received_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mfp_stripe_events_session ON stripe_events(session_id);
