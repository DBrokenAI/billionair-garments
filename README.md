# Billionaire Garments

The online shop for Billionaire Garments, a clothing brand selling embroidered heavyweight sweatsuit sets. Shoppers browse the sets, pick a size, and pay through Stripe. The owner signs in to a private dashboard to see traffic and sales, ship orders, and update stock.

**Setting it up or taking it over? Read [SETUP.md](SETUP.md).** It covers Cloudflare, the domain, Stripe, going live, and running the shop day to day.

## What it does

**The shop** (`/`)

- Product grid with per-size stock: "N in stock", "Only N left" at three or fewer, or a struck-through "Sold out".
- Slide-in bag with quantity controls, saved in the browser between visits and checked against live stock on every load.
- Checkout on Stripe's hosted payment page: cards, Apple Pay and the other methods enabled in the Stripe account. Card details never touch this site.
- Stock is held the moment a shopper starts checkout, so two people cannot buy the last set. The hold becomes a sale when Stripe confirms payment, or is released if the shopper cancels, the checkout expires (31 minutes), or the payment fails.
- Mailing-list sign-up by email.
- Logo intro, hero slideshow, scroll reveals; all skipped for people who prefer reduced motion.

**The owner dashboard** (`/admin`, password protected)

- Right now: visitors on the site, shoppers in checkout, orders waiting to ship, stock alerts.
- Sales, orders, visitors and conversion for the last 7, 30 or 90 days, each compared with the period before.
- Visitors and sales per day, the visit → bag → checkout → purchase funnel, and where visitors come from (referring site, country, device).
- Orders with customer, items and shipping address; mark shipped with an optional tracking number, which emails the customer.
- Products: add, edit, hide, reorder and delete sets; names, prices, badges, stock per size, and photo uploads (shrunk in the browser, stored in the database).
- Settings: shipping prices, sales tax switch, top-bar messages, contact email, email switches, and the returns / privacy / terms pages.
- Download the mailing list as a spreadsheet; change the dashboard password.

Nothing in day-to-day running needs a code change or a deploy.

Traffic is counted first-party with no cookies and no stored IP addresses: each visit is logged against a hash that changes daily.

## How it is built

No framework, no build step, one dev dependency (Cloudflare's `wrangler` CLI).

```
public/            Static pages, served as-is
  index.html         The shop
  script.js          Shop behavior: grid, bag, checkout, sign-up
  styles.css         All shop styling
  thanks.html        Order confirmation page
  policy.html        Returns / privacy / terms pages (text comes from the dashboard)
  admin/index.html   Owner dashboard (single file; charts are hand-written SVG)
  images/            Logo and the original product photography
src/
  worker.js          The whole backend: a Cloudflare Worker handling /api/* and /img/*
  catalog.js         Sizes, and the default shop settings
schema.sql         Database tables, starting products and stock (Cloudflare D1 / SQLite)
wrangler.jsonc     Cloudflare configuration
SETUP.md           Setup and operations guide
```

- **Products and settings live in the database**, not the code: tables `products`, `stock`, `images` and the `site` row of `settings`. `schema.sql` seeds the first five sets.
- **Prices are server-side.** The browser sends only product ids, sizes and quantities. `worker.js` prices the order from the database.
- **Emails are optional.** With a `RESEND_API_KEY` secret, the Worker sends plain-text emails through Resend from `orders@<the site's domain>`. Without it, nothing is sent and the dashboard says so.
- **Abuse limits.** Checkout (12 per 10 minutes) and sign-up (6 per 10 minutes) are limited per IP address, one order holds at most 10 sets, and the visit counter ignores more than 40 hits a minute from one address.
- **Security headers** for every page are in `public/_headers` (content security policy, no framing, HTTPS only).
- **Order state follows Stripe.** A signed webhook settles each order; the thank-you page and a 10-minute cron job check Stripe directly as backups, so a missed webhook cannot lose an order or strand held stock.
- **Secrets stay out of the repo.** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `ADMIN_PASSWORD` are Cloudflare secrets. This repository is public: never commit a key.
- **Dashboard login** is one password. The owner sets their own from the dashboard (stored as a salted PBKDF2 hash in D1); until then the `ADMIN_PASSWORD` secret is a temporary first-login password. It is checked in constant time, rate-limited to 8 tries per 15 minutes, and held in a signed `HttpOnly; Secure; SameSite=Strict` cookie for 14 days.

## Run it locally

Needs [Node.js](https://nodejs.org).

```sh
npm install
cp .dev.vars.example .dev.vars    # then fill in Stripe TEST keys and a password
npm run db:local                  # create the local database
npm run dev                       # http://localhost:8787  (dashboard at /admin)
```

Pay with Stripe's test card `4242 4242 4242 4242`, any future date, any CVC. To receive webhooks locally, run `stripe listen --forward-to localhost:8787/api/stripe/webhook` with the [Stripe CLI](https://docs.stripe.com/stripe-cli) and put the `whsec_` secret it prints in `.dev.vars`. Without it, orders still confirm via the thank-you page.

## Limitations

- US shipping addresses only, and two fixed sizes (S/M, L/XL): both are set in code.
- Sales tax is off until Stripe Tax is set up and the switch is ticked in Settings.
- Refunds are issued in Stripe. The owner then marks the order "Cancelled / refunded" in the dashboard, which can put the items back in stock.
- The sign-up form stores email addresses; it does not send marketing email itself. Export the list to a mailing service.
- Uploaded photos are capped at 1.5 MB after shrinking (a D1 row limit); fine for product photos, not for video.
- One owner password, no separate staff accounts.
- No automated test suite.
