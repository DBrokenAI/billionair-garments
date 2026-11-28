-- Billionaire Garments database (Cloudflare D1).
-- Safe to run more than once: it never overwrites existing data, and the
-- starting sets at the bottom are only ever added the first time.

-- The sets for sale. Edited from /admin (Products). Money is in cents.
-- image / hover are paths: "images/..." for the original photos shipped with
-- the site, "img/<id>" for photos uploaded from the dashboard.
CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  was_cents   INTEGER,
  badge       TEXT NOT NULL DEFAULT '',
  image       TEXT NOT NULL DEFAULT '',
  hover       TEXT NOT NULL DEFAULT '',
  pos         TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0
);

-- Units left per product and size. Edited from /admin (Products).
CREATE TABLE IF NOT EXISTS stock (
  product_id TEXT NOT NULL,
  size       TEXT NOT NULL,
  qty        INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  PRIMARY KEY (product_id, size)
);

-- Photos uploaded from the dashboard (shrunk in the browser first, under 1.5 MB each).
CREATE TABLE IF NOT EXISTS images (
  id   TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data BLOB NOT NULL,
  ts   INTEGER NOT NULL
);

-- One row per checkout. status: pending -> paid | processing | expired | failed; paid -> refunded (set by the owner in the dashboard).
-- Money is stored in cents. items is a JSON list of {id, size, qty, name, color, price}.
CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  stripe_session_id TEXT UNIQUE,
  status            TEXT NOT NULL,
  items             TEXT NOT NULL,
  subtotal          INTEGER NOT NULL,
  amount_total      INTEGER,
  email             TEXT,
  name              TEXT,
  phone             TEXT,
  shipping          TEXT,
  tracking          TEXT,
  origin            TEXT,
  created_at        INTEGER NOT NULL,
  paid_at           INTEGER,
  shipped_at        INTEGER
);
CREATE INDEX IF NOT EXISTS orders_status ON orders (status, created_at);
CREATE INDEX IF NOT EXISTS orders_paid ON orders (paid_at);
CREATE INDEX IF NOT EXISTS orders_status_paid ON orders (status, paid_at);   -- the dashboard's sales figures

-- Anonymous traffic log. type: view | add | checkout.
-- visitor is a hash that changes every day; no IP address or cookie is stored.
CREATE TABLE IF NOT EXISTS events (
  ts      INTEGER NOT NULL,
  type    TEXT NOT NULL,
  path    TEXT,
  ref     TEXT,
  country TEXT,
  device  TEXT,
  visitor TEXT
);
-- Holds every column the dashboard reads, so its traffic figures come straight from the index.
DROP INDEX IF EXISTS events_ts;
CREATE INDEX IF NOT EXISTS events_cover ON events (ts, type, visitor, ref, country, device);

-- The mailing list (email only; the phone column is unused and kept so old databases still match).
CREATE TABLE IF NOT EXISTS signups (
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  ts    INTEGER NOT NULL,
  UNIQUE (email, phone)
);

-- Saved settings, each a JSON value:
--   'site'            shop settings edited in /admin (shipping, tax, top-bar messages, policies, ...)
--   'owner_password'  the owner's dashboard password, salted and hashed (never the password itself).
--                     Deleting that row makes the temporary ADMIN_PASSWORD secret work again.
--   'tax_error'       set if Stripe refused to add sales tax, so the dashboard can say so
--   'seeded'          set once the starting sets below have been added
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Recent attempts, used to slow down password guessing and form/checkout abuse.
-- ip is "<what>:<address>" for limits other than login.
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts (ip, ts);

-- The starting sets. Added once only: running this file again later never brings
-- back a set the owner has deleted. Stock starts at 0 (everything shows "Sold out")
-- until the owner enters the real numbers under Products in the dashboard.
INSERT OR IGNORE INTO products (id, name, color, price_cents, was_cents, badge, image, hover, pos, sort)
SELECT * FROM (VALUES
  ('signature-set', 'Signature Sweatsuit',    'Black / White Script',  16000, NULL, '', 'images/dock.jpg',        'images/gate.jpg',        '',        0),
  ('royal-set',     'Royal Script Sweatsuit', 'Black / Purple Script', 16000, NULL, '', 'images/purple-back.jpg', 'images/purple-side.jpg', '',        1),
  ('crimson-set',   'Crimson Logo Sweatsuit', 'Black / Red Logo',      16000, NULL, '', 'images/embroidery.jpg',  '',                       '',        2),
  ('midnight-set',  'Midnight Sweatsuit',     'All Black',             15000, NULL, '', 'images/gate.jpg',        'images/dock.jpg',        '50% 45%', 3),
  ('lakeside-set',  'Lakeside Sweatsuit',     'Black / White Script',  15000, NULL, '', 'images/purple-side.jpg', 'images/dock.jpg',        '',        4)
) WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'seeded');

INSERT OR IGNORE INTO stock (product_id, size, qty)
SELECT * FROM (VALUES
  ('signature-set', 'S/M', 0), ('signature-set', 'L/XL', 0),
  ('royal-set',     'S/M', 0), ('royal-set',     'L/XL', 0),
  ('crimson-set',   'S/M', 0), ('crimson-set',   'L/XL', 0),
  ('midnight-set',  'S/M', 0), ('midnight-set',  'L/XL', 0),
  ('lakeside-set',  'S/M', 0), ('lakeside-set',  'L/XL', 0)
) WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'seeded');

INSERT OR IGNORE INTO settings (key, value) VALUES ('seeded', '1');
