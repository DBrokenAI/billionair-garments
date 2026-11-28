/* ============================================
   Billionaire Garments — the server
   ============================================
   Runs on Cloudflare Workers. The pages in /public are served as-is;
   everything under /api/ and /img/ is handled here:

     Shop       /api/products, /api/checkout, /api/order, /api/signup, /api/policy, /api/t
     Photos     /img/<id>      (photos uploaded from the dashboard)
     Stripe     /api/stripe/webhook
     Dashboard  /api/admin/*   (owner login required)

   Secrets it expects (Cloudflare → Variables and Secrets):
     STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET   payments
     ADMIN_PASSWORD                             temporary first dashboard password
     RESEND_API_KEY                             optional: turns on emails
*/

import { SIZES, SIZE_LABELS, SITE_DEFAULTS } from "./catalog.js";

const HOLD_MINUTES = 31;          // how long stock is held for someone in checkout (Stripe's minimum is 30)
const SESSION_DAYS = 14;          // how long a dashboard login lasts
const MAX_PER_ORDER = 10;         // sets in one order; more than this is a bulk order by email
const MAX_PHOTO_BYTES = 1500000;  // the dashboard shrinks photos well under this before uploading
const POLICIES = { returns: "Returns & Exchanges", privacy: "Privacy Policy", terms: "Terms of Sale" };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/img/")) return await servePhoto(request, env, ctx, url);
      if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
      return await route(request, env, url);
    } catch (err) {
      console.error(err.stack || err);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  },

  // Cron: release stock held by abandoned checkouts, tidy old rows.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sweep(env));
  },
};

/* ---------- Routing ---------- */
const ROUTES = {
  "GET /api/products": products,
  "GET /api/policy": policy,
  "POST /api/checkout": checkout,
  "POST /api/checkout/cancel": cancelCheckout,
  "GET /api/order": orderStatus,
  "POST /api/stripe/webhook": stripeWebhook,
  "POST /api/signup": signup,
  "POST /api/t": track,
  "POST /api/admin/login": login,
  "POST /api/admin/logout": logout,
  "POST /api/admin/password": changePassword,
  "GET /api/admin/summary": summary,
  "POST /api/admin/product": saveProduct,
  "POST /api/admin/product/move": moveProduct,
  "POST /api/admin/product/delete": deleteProduct,
  "POST /api/admin/photo": uploadPhoto,
  "POST /api/admin/settings": saveSettings,
  "POST /api/admin/ship": markShipped,
  "POST /api/admin/order/cancel": cancelOrder,
  "GET /api/admin/signups.csv": signupsCsv,
};

async function route(request, env, url) {
  const handler = ROUTES[`${request.method === "HEAD" ? "GET" : request.method} ${url.pathname}`];
  if (!handler) return json({ error: "Not found" }, 404);

  // Browsers say which site a POST came from; refuse ones from other sites.
  // (Stripe's webhook is not a browser and is checked by signature instead.)
  if (request.method === "POST" && handler !== stripeWebhook) {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json({ error: "Forbidden" }, 403);
  }

  if (url.pathname.startsWith("/api/admin/") && handler !== login && handler !== logout) {
    if (!(await isOwner(request, env))) return json({ error: "Please sign in." }, 401);
  }
  return handler(request, env, url);
}

/* ---------- Small helpers ---------- */
const now = () => Math.floor(Date.now() / 1000);
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const randomId = bytes => hex(crypto.getRandomValues(new Uint8Array(bytes)));

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
  });
}
async function sha256(text) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}
async function hmac(key, text) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(text)));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const clip = (v, n) => String(v ?? "").slice(0, n);
const usd = cents => "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// Who is asking, for rate limits. An IPv6 customer usually has a whole block of
// addresses, so those are counted by their block (the first four groups).
function clientKey(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  if (!ip.includes(":")) return ip;
  const [head, tail] = ip.split("::");            // "::" stands for a run of zero groups
  const a = head ? head.split(":") : [], b = tail ? tail.split(":") : [];
  const groups = tail === undefined ? a : [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b];
  return groups.slice(0, 4).join(":");
}

// Counts an attempt and says whether this visitor has made too many lately.
// The count and the new attempt are recorded together, so a burst of requests
// sent at the same moment cannot all slip under the limit. Once someone is over
// the limit their further attempts are not recorded (nothing to gain by flooding).
async function overLimit(env, request, what, max, minutes) {
  const key = `${what}:${clientKey(request)}`, since = now() - minutes * 60;
  const [count] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) n FROM login_attempts WHERE ip = ?1 AND ts > ?2").bind(key, since),
    env.DB.prepare(
      `INSERT INTO login_attempts (ip, ts) SELECT ?1, ?3
       WHERE (SELECT COUNT(*) FROM login_attempts WHERE ip = ?1 AND ts > ?2) < ?4`).bind(key, since, now(), max),
  ]);
  return count.results[0].n >= max;
}
const clearLimit = (env, request, what) =>
  env.DB.prepare("DELETE FROM login_attempts WHERE ip = ?1").bind(`${what}:${clientKey(request)}`).run();

// A cheap in-memory brake for the visit counter, which is called on every page
// view and must not cost a database write per request when someone hammers it.
const hits = new Map();
function tooFast(request, max, seconds) {
  const key = clientKey(request), t = now();
  if (hits.size > 5000) hits.clear();
  const h = hits.get(key);
  if (!h || t - h.start >= seconds) { hits.set(key, { start: t, n: 1 }); return false; }
  return ++h.n > max;
}

/* ---------- Products, stock and shop settings (all edited in the dashboard) ---------- */
const toProduct = r => ({
  id: r.id, name: r.name, color: r.color,
  price: r.price_cents / 100, was: r.was_cents ? r.was_cents / 100 : null,
  badge: r.badge, image: r.image, hover: r.hover, pos: r.pos,
  active: !!r.active, sort: r.sort,
});

async function loadShop(env, includeHidden = false) {
  const [p, s, site] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM products ${includeHidden ? "" : "WHERE active = 1"} ORDER BY sort, rowid`),
    env.DB.prepare("SELECT product_id, size, qty FROM stock"),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'site'"),
  ]);
  const stock = {};
  for (const r of s.results) (stock[r.product_id] ??= {})[r.size] = r.qty;
  return {
    site: { ...SITE_DEFAULTS, ...(site.results[0] ? JSON.parse(site.results[0].value) : {}) },
    products: p.results.map(r => ({
      ...toProduct(r),
      stock: Object.fromEntries(SIZES.map(z => [z, stock[r.id]?.[z] ?? 0])),
    })),
  };
}

async function products(request, env) {
  const { site, products } = await loadShop(env);
  return json({
    sizes: SIZES,
    sizeLabels: SIZE_LABELS,
    products: products.map(({ active, sort, ...p }) => p),
    site: {
      announcements: site.announcements,
      contactEmail: site.contactEmail,
      flatShipping: site.flatShipping, freeShippingMin: site.freeShippingMin, tax: site.tax,   // cents, for the bag
      policies: Object.keys(POLICIES).filter(k => site[k].trim()).map(k => ({ key: k, title: POLICIES[k] })),
    },
  });
}

async function policy(request, env, url) {
  const key = url.searchParams.get("p");
  const { site } = await loadShop(env);
  if (!POLICIES[key] || !site[key].trim()) return json({ error: "Not found" }, 404);
  return json({ title: POLICIES[key], text: site[key], contactEmail: site.contactEmail });
}

// Photos uploaded from the dashboard, kept in the database and cached at Cloudflare's edge.
async function servePhoto(request, env, ctx, url) {
  const id = url.pathname.slice(5);
  // (No "?anything" variants: each would be stored again in the cache and re-read from the database.)
  if (request.method !== "GET" || url.search || !/^[0-9a-f]{16,32}$/.test(id)) return new Response("Not found", { status: 404 });
  const cached = await caches.default.match(request);
  if (cached) return cached;
  const row = await env.DB.prepare("SELECT type, data FROM images WHERE id = ?1").bind(id).first();
  if (!row) return new Response("Not found", { status: 404 });
  const res = new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.type,
      "Cache-Control": "public, max-age=31536000, immutable",   // a new upload gets a new address
      "X-Content-Type-Options": "nosniff",
    },
  });
  ctx.waitUntil(caches.default.put(request, res.clone()));
  return res;
}

/* ---------- Stripe ---------- */
async function stripe(env, method, path, params) {
  const res = await fetch("https://api.stripe.com/v1" + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(`Stripe ${method} ${path}: ${data?.error?.message || res.status}`);
    err.status = res.status;
    err.code = data?.error?.code || "";
    throw err;
  }
  return data;
}

/* ---------- Email (optional) ----------
   Sent through Resend when the RESEND_API_KEY secret is set. Without it the
   shop works exactly the same, just with no emails from the site itself. */
async function sendEmail(env, site, origin, to, subject, lines) {
  if (!env.RESEND_API_KEY) return { sent: false, why: "Emails aren't switched on yet." };
  if (!to || !isEmail(to)) return { sent: false, why: "There is no email address for this order." };
  try {
    const host = new URL(origin).hostname.replace(/^www\./, "");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `Billionaire Garments <orders@${host}>`,
        to: [to],
        reply_to: site.contactEmail,
        subject,
        text: lines.filter(l => l !== null).join("\n"),
      }),
    });
    if (res.ok) return { sent: true };
    console.error("Resend:", res.status, await res.text());
    return { sent: false, why: "The email service refused it. Check the Resend account." };
  } catch (err) {
    console.error("Resend:", err.message);
    return { sent: false, why: "The email service couldn't be reached." };
  }
}

// The short order number shown to the owner and the customer, e.g. #3F9A12BC.
const orderNo = id => "#" + String(id).replace(/-/g, "").slice(0, 8).toUpperCase();
const itemLines = items => items.map(i => `  ${i.qty} x ${i.name} (${i.color}, ${SIZE_LABELS[i.size] || i.size})`);
const addressLines = a => a ? [a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(", ")].filter(Boolean).map(l => "  " + l) : [];

/* ---------- Checkout ----------
   1. Check the bag against the products (prices come from the server, never the browser).
   2. Hold the stock so two people can't buy the last one.
   3. Send the shopper to Stripe's payment page.
   The hold becomes a sale when Stripe says "paid", or is released when the
   checkout is cancelled, expires, or fails. */
async function checkout(request, env, url) {
  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: "Checkout isn't switched on yet. Please contact us to order." }, 503);
  }
  if (await overLimit(env, request, "checkout", 12, 10)) {
    return json({ error: "Too many checkout attempts. Please wait a few minutes and try again." }, 429);
  }
  const body = await request.json().catch(() => null);
  const { site, products: catalogue } = await loadShop(env);
  const merged = new Map();
  for (const line of Array.isArray(body?.items) ? body.items.slice(0, 40) : []) {
    const p = catalogue.find(x => x.id === line?.id);
    const qty = Number(line?.qty);
    if (!p || !SIZES.includes(line.size) || !Number.isInteger(qty) || qty < 1) {
      return json({ error: "Your bag has an item we no longer sell. It has been refreshed.", stock: true }, 409);
    }
    const key = p.id + "|" + line.size;
    const item = merged.get(key) || { id: p.id, size: line.size, qty: 0, name: p.name, color: p.color, price: Math.round(p.price * 100) };
    item.qty += qty;
    merged.set(key, item);
  }
  const items = [...merged.values()];
  if (!items.length) return json({ error: "Your bag is empty." }, 400);
  // Stock is held the moment checkout starts, so one order may not hold the whole shop.
  if (items.reduce((sum, i) => sum + i.qty, 0) > MAX_PER_ORDER) {
    return json({ error: `For more than ${MAX_PER_ORDER} sets in one order, please email us for a bulk order.` }, 400);
  }
  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);

  // If this shopper left an earlier checkout unfinished (pressed "back", then
  // Checkout again), close it first. Otherwise their own held stock would block them.
  await cancelPending(env, body.replaces);

  // Hold the stock. Each UPDATE only succeeds if enough units are left.
  const orderId = crypto.randomUUID();
  const held = await env.DB.batch([
    env.DB.prepare("INSERT INTO orders (id, status, items, subtotal, origin, created_at) VALUES (?1, 'pending', ?2, ?3, ?4, ?5)")
      .bind(orderId, JSON.stringify(items), subtotal, url.origin, now()),
    ...items.map(i => env.DB.prepare(
      "UPDATE stock SET qty = qty - ?1 WHERE product_id = ?2 AND size = ?3 AND qty >= ?1").bind(i.qty, i.id, i.size)),
  ]);
  const short = items.filter((_, k) => held[k + 1].meta.changes !== 1);
  if (short.length) {
    await env.DB.batch([
      ...items.filter(i => !short.includes(i)).map(i => env.DB.prepare(
        "UPDATE stock SET qty = qty + ?1 WHERE product_id = ?2 AND size = ?3").bind(i.qty, i.id, i.size)),
      env.DB.prepare("DELETE FROM orders WHERE id = ?1").bind(orderId),
    ]);
    return json({
      error: `Sorry, there aren't enough ${short[0].name} (${short[0].size}) left. Your bag has been updated.`,
      stock: true,
    }, 409);
  }

  // Build the Stripe payment page.
  const params = [
    ["mode", "payment"],
    ["adaptive_pricing[enabled]", "false"],   // always US dollars, so the amounts match the order
    ["client_reference_id", orderId],
    ["metadata[order_id]", orderId],
    ["success_url", `${url.origin}/thanks?session_id={CHECKOUT_SESSION_ID}`],
    ["cancel_url", `${url.origin}/?cancelled=${orderId}`],
    ["expires_at", String(now() + HOLD_MINUTES * 60)],
    ["shipping_address_collection[allowed_countries][0]", "US"],
    ["phone_number_collection[enabled]", "true"],
  ];
  const publicSite = url.protocol === "https:";   // Stripe can only load product photos from a live site
  items.forEach((i, k) => {
    const p = catalogue.find(x => x.id === i.id);
    const at = `line_items[${k}]`;
    params.push(
      [`${at}[quantity]`, String(i.qty)],
      [`${at}[price_data][currency]`, "usd"],
      [`${at}[price_data][unit_amount]`, String(i.price)],
      [`${at}[price_data][product_data][name]`, `${i.name} (${SIZE_LABELS[i.size] || i.size})`],
    );
    if (i.color) params.push([`${at}[price_data][product_data][description]`, i.color]);
    if (publicSite && p.image) params.push([`${at}[price_data][product_data][images][0]`, `${url.origin}/${p.image}`]);
  });
  const free = subtotal >= site.freeShippingMin;
  const ship = "shipping_options[0][shipping_rate_data]";
  params.push(
    [`${ship}[type]`, "fixed_amount"],
    [`${ship}[display_name]`, free ? "Free shipping" : "Standard shipping"],
    [`${ship}[fixed_amount][currency]`, "usd"],
    [`${ship}[fixed_amount][amount]`, free ? "0" : String(site.flatShipping)],
  );

  let session;
  try {
    try {
      session = await stripe(env, "POST", "/checkout/sessions", site.tax ? [...params, ["automatic_tax[enabled]", "true"]] : params);
      if (site.tax) await env.DB.prepare("DELETE FROM settings WHERE key = 'tax_error'").run();   // tax is working
    } catch (err) {
      // Only when Stripe rejected the request because of the tax setting. A wrong key,
      // a busy or unreachable Stripe, or any other problem must not quietly drop the tax.
      if (!site.tax || err.status !== 400 || !/tax/i.test(err.message)) throw err;
      // Sales tax is switched on but Stripe refused (Stripe Tax not set up yet).
      // Don't lose the sale: check out without tax and tell the owner in the dashboard.
      console.error(err.message);
      await env.DB.prepare(
        "INSERT INTO settings (key, value) VALUES ('tax_error', ?1) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
        .bind(JSON.stringify(clip(err.message, 300))).run();
      session = await stripe(env, "POST", "/checkout/sessions", params);
    }
  } catch (err) {
    console.error(err.message);
    await release(env, { id: orderId, items: JSON.stringify(items) }, "failed");
    return json({ error: "We couldn't start checkout. Please try again in a moment." }, 502);
  }
  await env.DB.prepare("UPDATE orders SET stripe_session_id = ?1 WHERE id = ?2").bind(session.id, orderId).run();
  return json({ url: session.url, order: orderId });
}

// Put held stock back and close the order. Does nothing if the order was
// already paid or already released, so it is safe to call twice.
async function release(env, order, status) {
  const items = JSON.parse(order.items);
  await env.DB.batch([
    ...items.map(i => env.DB.prepare(
      `UPDATE stock SET qty = qty + ?1 WHERE product_id = ?2 AND size = ?3
       AND EXISTS (SELECT 1 FROM orders WHERE id = ?4 AND status IN ('pending', 'processing'))`)
      .bind(i.qty, i.id, i.size, order.id)),
    env.DB.prepare("UPDATE orders SET status = ?1 WHERE id = ?2 AND status IN ('pending', 'processing')")
      .bind(status, order.id),
  ]);
}

// Bring our order in line with what Stripe says about its checkout session.
async function applySession(env, session, failed = false) {
  // Find the order by the session id we stored, or by the order id we put in the
  // session's metadata when creating it (a customer cannot set metadata).
  const order = await env.DB.prepare("SELECT * FROM orders WHERE stripe_session_id = ?1 OR id = ?2")
    .bind(session.id, session.metadata?.order_id || "").first();
  if (!order) return;
  // It must be the session made for this order, for this order's amount. Anything
  // else in the same Stripe account (a payment link, another tool) is ignored.
  if (order.stripe_session_id && order.stripe_session_id !== session.id) return;
  // (When the ids already match it is certainly ours, so the amount is not second-guessed.)
  if (!order.stripe_session_id && session.amount_subtotal != null && session.amount_subtotal !== order.subtotal) {
    console.error(`Ignored session ${session.id}: amount does not match order ${order.id}`);
    return;
  }

  if (failed || session.status === "expired") {
    return release(env, order, failed ? "failed" : "expired");
  }
  if (session.status !== "complete") return;   // still on the payment page

  const paid = session.payment_status !== "unpaid";   // "unpaid" = a bank payment still clearing
  const who = session.customer_details || {};
  const shipTo = session.collected_information?.shipping_details || session.shipping_details || null;
  const total = session.amount_total ?? order.subtotal;
  const name = shipTo?.name || who.name || null;
  const res = await env.DB.prepare(
    `UPDATE orders SET status = ?1, stripe_session_id = ?2, amount_total = ?3, email = ?4, name = ?5, phone = ?6,
       shipping = ?7, paid_at = COALESCE(paid_at, ?8)
     WHERE id = ?9 AND (status IN ('pending', 'processing') OR (?10 = 1 AND status IN ('expired', 'failed')))`)
    .bind(paid ? "paid" : "processing", session.id, total,
      who.email || null, name, who.phone || null,
      shipTo ? JSON.stringify(shipTo.address || {}) : null, paid ? now() : null, order.id, paid ? 1 : 0)
    .run();

  // Paid after the hold had already been released (rare: Stripe was unreachable
  // for a day, then the payment turned out to be good). The units went back on
  // sale when it was released, so take them again.
  if (res.meta.changes && ["expired", "failed"].includes(order.status)) {
    await env.DB.batch(JSON.parse(order.items).map(i => env.DB.prepare(
      "UPDATE stock SET qty = MAX(0, qty - ?1) WHERE product_id = ?2 AND size = ?3").bind(i.qty, i.id, i.size)));
  }

  // First time this order is seen as paid: tell the owner.
  if (paid && res.meta.changes && order.origin) {
    const { site } = await loadShop(env);
    if (site.orderAlerts) {
      const items = JSON.parse(order.items);
      await sendEmail(env, site, order.origin, site.contactEmail, `New order ${orderNo(order.id)}: ${usd(total)} from ${name || who.email || "a customer"}`, [
        `You have a new order for ${usd(total)}. Order number ${orderNo(order.id)}.`, "",
        "Items:", ...itemLines(items), "",
        "Ship to:", `  ${name || ""}`, ...addressLines(shipTo?.address), "",
        `Customer: ${who.email || ""}${who.phone ? "  " + who.phone : ""}`, "",
        `Mark it shipped when it's in the mail: ${order.origin}/admin`,
      ]);
    }
  }
}

// Shopper pressed "back" on the Stripe page: close the session and free the stock now.
async function cancelCheckout(request, env) {
  const body = await request.json().catch(() => null);
  await cancelPending(env, body?.order);
  return json({ ok: true });
}

// Close one unfinished checkout and free its stock. Does nothing to a paid order.
async function cancelPending(env, orderId) {
  if (!orderId) return;
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?1 AND status = 'pending'")
    .bind(clip(orderId, 64)).first();
  if (order?.stripe_session_id && env.STRIPE_SECRET_KEY) {
    try {
      await applySession(env, await stripe(env, "POST", `/checkout/sessions/${order.stripe_session_id}/expire`));
    } catch (err) {
      console.error(err.message);   // e.g. they had actually paid; the webhook / sweep settles it
    }
  }
}

// The thank-you page asks this to confirm the payment went through.
async function orderStatus(request, env, url) {
  const id = url.searchParams.get("session_id") || "";
  if (!env.STRIPE_SECRET_KEY || !/^cs_[A-Za-z0-9_]{10,}$/.test(id)) return json({ paid: false }, 400);
  const ours = await env.DB.prepare("SELECT id FROM orders WHERE stripe_session_id = ?1").bind(id).first();
  if (!ours) return json({ paid: false }, 404);
  let session;
  try {
    session = await stripe(env, "GET", `/checkout/sessions/${id}`);
  } catch {
    return json({ paid: false }, 404);
  }
  await applySession(env, session);
  return json({
    contactEmail: (await loadShop(env)).site.contactEmail,
    order: orderNo(ours.id),
    paid: session.status === "complete" && session.payment_status !== "unpaid",
    processing: session.status === "complete" && session.payment_status === "unpaid",   // a bank payment still clearing
    email: session.customer_details?.email || "",
    total: session.amount_total,
  });
}

// Stripe calls this when a payment completes, expires or fails.
async function stripeWebhook(request, env) {
  const raw = await request.text();
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "Webhook secret not set" }, 503);

  const header = request.headers.get("Stripe-Signature") || "";
  const stamp = header.match(/(?:^|,)t=(\d+)/)?.[1];
  const sigs = [...header.matchAll(/(?:^|,)v1=([0-9a-f]+)/g)].map(m => m[1]);
  const expected = stamp ? await hmac(env.STRIPE_WEBHOOK_SECRET, `${stamp}.${raw}`) : "";
  const fresh = stamp && Math.abs(now() - Number(stamp)) <= 300;
  if (!fresh || !sigs.some(s => safeEqual(s, expected))) return json({ error: "Bad signature" }, 400);

  const event = JSON.parse(raw);
  if (event.type?.startsWith("checkout.session.")) {
    await applySession(env, event.data.object, event.type === "checkout.session.async_payment_failed");
  }
  return json({ received: true });
}

// Safety net, run by the cron: settles any checkout the webhook missed.
async function sweep(env) {
  const cutoff = now() - (HOLD_MINUTES + 4) * 60;
  const { results } = await env.DB.prepare(
    `SELECT * FROM orders WHERE (status = 'pending' AND created_at < ?1) OR (status = 'processing' AND created_at < ?2)
     ORDER BY created_at LIMIT 20`).bind(cutoff, now() - 86400).all();
  for (const order of results) {
    try {
      if (!order.stripe_session_id) await release(env, order, "failed");   // never reached Stripe, so nobody paid
      else if (!env.STRIPE_SECRET_KEY) continue;                           // can't ask Stripe: leave it alone
      else await applySession(env, await stripe(env, "GET", `/checkout/sessions/${order.stripe_session_id}`));
    } catch (err) {
      console.error(err.message);
      // Stripe doesn't know this checkout (e.g. a test-mode one after switching to the
      // live key), or it has been failing for a day: give the stock back and move on,
      // so one stuck row can't block the rest.
      if (order.status === "pending" && (err.code === "resource_missing" || order.created_at < now() - 86400)) {
        await release(env, order, "failed").catch(e => console.error(e.message));
      }
    }
  }
  // Housekeeping: old attempt records, abandoned checkouts older than 30 days,
  // and uploaded photos that no product uses any more.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_attempts WHERE ts < ?1").bind(now() - 86400),
    env.DB.prepare("DELETE FROM events WHERE ts < ?1").bind(now() - 200 * 86400),   // the dashboard looks back 180 days at most
    env.DB.prepare("DELETE FROM orders WHERE status IN ('expired', 'failed') AND created_at < ?1").bind(now() - 30 * 86400),
    env.DB.prepare(
      `DELETE FROM images WHERE ts < ?1
       AND 'img/' || id NOT IN (SELECT image FROM products)
       AND 'img/' || id NOT IN (SELECT hover FROM products)`).bind(now() - 86400),
  ]);
}

/* ---------- Mailing list ---------- */
async function signup(request, env) {
  if (await overLimit(env, request, "signup", 6, 10)) {
    return json({ error: "Too many tries. Please wait a few minutes." }, 429);
  }
  const body = await request.json().catch(() => null);
  const email = clip(body?.email, 200).trim().toLowerCase();
  if (!isEmail(email)) return json({ error: "Please enter a valid email." }, 400);
  await env.DB.prepare("INSERT OR IGNORE INTO signups (email, phone, ts) VALUES (?1, '', ?2)").bind(email, now()).run();
  return json({ ok: true });
}

/* ---------- Traffic ----------
   Each page view / add-to-bag / checkout click is logged with no cookie and
   no IP address: just a hash that changes daily, so visitors can be counted
   without being identifiable. */
const EVENT_TYPES = ["view", "add", "checkout"];
const BOTS = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|scrapy/i;

async function track(request, env, url) {
  const body = await request.json().catch(() => null);
  const ua = request.headers.get("User-Agent") || "";
  if (!EVENT_TYPES.includes(body?.t) || !ua || BOTS.test(ua)) return new Response(null, { status: 204 });
  if (tooFast(request, 40, 60)) return new Response(null, { status: 204 });   // far more than a person browsing

  let ref = clip(body.s, 60).toLowerCase().replace(/[^a-z0-9._-]/g, "");   // ?utm_source=... wins if present
  if (!ref && body.r) {
    try {
      const host = new URL(body.r).hostname.replace(/^www\./, "");
      if (host !== url.hostname.replace(/^www\./, "")) ref = host;
    } catch {}
  }
  const day = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const visitor = (await sha256(`${day}|${ip}|${ua}|${env.ADMIN_PASSWORD || ""}`)).slice(0, 16);
  await env.DB.prepare("INSERT INTO events (ts, type, path, ref, country, device, visitor) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(now(), body.t, clip(body.p, 120), clip(ref, 80), request.cf?.country || "",
      /Mobi|Android|iPhone|iPad/i.test(ua) ? "Phone / tablet" : "Computer", visitor)
    .run();
  return new Response(null, { status: 204 });
}

/* ---------- Owner login ----------
   One password. A successful login sets a signed, HttpOnly cookie. */
const COOKIE = "bg_owner";

/* The password is whichever of these exists, in this order:
   1. The owner's own, chosen in the dashboard. Stored salted and hashed in the
      database, so nobody (including whoever set the site up) can read it.
   2. The ADMIN_PASSWORD secret: the temporary one used to sign in the first time.
   Forgotten? Delete the 'owner_password' row from the settings table and the
   temporary one works again. */
async function ownPassword(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'owner_password'").first();
  return row ? JSON.parse(row.value) : null;   // { salt, hash }
}
async function slowHash(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/../g).map(b => parseInt(b, 16)));
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256));
}
async function passwordMatches(env, given, own) {
  if (own) return safeEqual(await slowHash(given, own.salt), own.hash);
  return !!env.ADMIN_PASSWORD && safeEqual(await sha256(given), await sha256(env.ADMIN_PASSWORD));
}
// Login cookies are signed with the current password, so changing it signs every device out.
const signingKey = (env, own) => own ? own.hash : env.ADMIN_PASSWORD;

async function sessionCookie(key) {
  const expires = now() + SESSION_DAYS * 86400;
  return `${COOKIE}=${expires}.${await hmac(key, "owner:" + expires)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`;
}

async function isOwner(request, env) {
  const key = signingKey(env, await ownPassword(env));
  if (!key) return false;
  const token = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1] || "";
  const [expires, sig] = token.split(".");
  if (!expires || !sig || Number(expires) < now()) return false;
  return safeEqual(sig, await hmac(key, "owner:" + expires));
}

// Slows down password guessing: 8 tries from one address in 15 minutes locks it
// until those 15 minutes pass. Every try is counted before the password is
// checked (so a burst can't get extra guesses) and the count is wiped by a
// correct password.
const LOCKED = { error: "Too many tries. Wait 15 minutes and try again." };

async function login(request, env) {
  const own = await ownPassword(env);
  if (!signingKey(env, own)) return json({ error: "The dashboard password hasn't been set yet. See SETUP.md." }, 503);
  if (await overLimit(env, request, "login", 8, 15)) return json(LOCKED, 429);

  const body = await request.json().catch(() => null);
  if (!(await passwordMatches(env, clip(body?.password, 500), own))) {
    return json({ error: "That password isn't right." }, 401);
  }
  await clearLimit(env, request, "login");
  return json({ ok: true }, 200, { "Set-Cookie": await sessionCookie(signingKey(env, own)) });
}

async function changePassword(request, env) {
  if (await overLimit(env, request, "login", 8, 15)) return json(LOCKED, 429);
  const body = await request.json().catch(() => null);
  const next = String(body?.next ?? "");
  if (!(await passwordMatches(env, clip(body?.current, 500), await ownPassword(env)))) {
    return json({ error: "Your current password isn't right." }, 401);
  }
  await clearLimit(env, request, "login");
  if (next.length < 10 || next.length > 200) return json({ error: "Choose a new password of at least 10 characters." }, 400);
  if (next === body.current) return json({ error: "The new password must be different from the current one." }, 400);

  const salt = randomId(16);
  const own = { salt, hash: await slowHash(next, salt) };
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('owner_password', ?1)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(own)).run();
  return json({ ok: true }, 200, { "Set-Cookie": await sessionCookie(own.hash) });   // keeps this device signed in
}

function logout() {
  return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` });
}

/* ---------- Dashboard data ---------- */
const ORDER_COLS = "id, status, items, amount_total, email, name, phone, shipping, tracking, paid_at, shipped_at, created_at";
async function summary(request, env, url) {
  const days = [7, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
  // The owner's clock offset from UTC, so "today" means their today.
  const off = Math.max(-840, Math.min(840, Number(url.searchParams.get("tz")) || 0)) * 60;
  const t = now();
  const today = Math.floor((t + off) / 86400) * 86400 - off;   // local midnight, as a UTC timestamp
  const start = today - (days - 1) * 86400;
  const prev = start - days * 86400;
  const db = env.DB;

  const traffic = `SELECT
      COALESCE(SUM(type = 'view'), 0) views,
      COUNT(DISTINCT CASE WHEN type = 'view' THEN visitor END) visitors,
      COUNT(DISTINCT CASE WHEN type = 'add' THEN visitor END) added,
      COUNT(DISTINCT CASE WHEN type = 'checkout' THEN visitor END) checkouts
    FROM events WHERE ts >= ?1 AND ts < ?2`;
  const sales = `SELECT COUNT(*) orders, COALESCE(SUM(amount_total), 0) revenue
    FROM orders WHERE status = 'paid' AND paid_at >= ?1 AND paid_at < ?2`;
  const top = col => `SELECT ${col} label, COUNT(DISTINCT visitor) visitors FROM events
    WHERE type = 'view' AND ts >= ?1 GROUP BY ${col} ORDER BY visitors DESC LIMIT 8`;

  const [tNow, tPrev, sNow, sPrev, dayTraffic, daySales, refs, countries, devices,
    toShip, finished, sold, signupStats, live, inCheckout, taxError] = await db.batch([
    db.prepare(traffic).bind(start, t + 1),
    db.prepare(traffic).bind(prev, start),
    db.prepare(sales).bind(start, t + 1),
    db.prepare(sales).bind(prev, start),
    db.prepare(`SELECT date(ts + ?2, 'unixepoch') day, COUNT(DISTINCT visitor) visitors, COUNT(*) views
      FROM events WHERE type = 'view' AND ts >= ?1 GROUP BY day`).bind(start, off),
    db.prepare(`SELECT date(paid_at + ?2, 'unixepoch') day, COUNT(*) orders, SUM(amount_total) revenue
      FROM orders WHERE status = 'paid' AND paid_at >= ?1 GROUP BY day`).bind(start, off),
    db.prepare(top("ref")).bind(start),
    db.prepare(top("country")).bind(start),
    db.prepare(top("device")).bind(start),
    db.prepare(`SELECT ${ORDER_COLS}
      FROM orders WHERE status IN ('paid', 'processing') AND shipped_at IS NULL ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 2000`),
    db.prepare(`SELECT ${ORDER_COLS}
      FROM orders WHERE (status = 'paid' AND shipped_at IS NOT NULL) OR status = 'refunded'
      ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 100`),
    db.prepare(`SELECT json_extract(j.value, '$.id') id, json_extract(j.value, '$.size') size,
        SUM(json_extract(j.value, '$.qty')) qty
      FROM orders, json_each(orders.items) j WHERE status = 'paid' AND paid_at >= ?1 GROUP BY 1, 2`).bind(start),
    db.prepare("SELECT COUNT(*) total, COALESCE(SUM(ts >= ?1), 0) recent FROM signups").bind(start),
    db.prepare("SELECT COUNT(DISTINCT visitor) n FROM events WHERE ts >= ?1").bind(t - 1800),
    db.prepare("SELECT COUNT(*) n FROM orders WHERE status = 'pending' AND created_at >= ?1").bind(t - HOLD_MINUTES * 60),
    db.prepare("SELECT value FROM settings WHERE key = 'tax_error'"),
  ]);
  const shop = await loadShop(env, true);

  // One entry per day, including days with nothing.
  const byDay = {};
  for (const r of dayTraffic.results) byDay[r.day] = { ...byDay[r.day], ...r };
  for (const r of daySales.results) byDay[r.day] = { ...byDay[r.day], ...r };
  const series = [];
  for (let i = 0; i < days; i++) {
    const day = new Date((start + off + i * 86400) * 1000).toISOString().slice(0, 10);
    const d = byDay[day] || {};
    series.push({ day, visitors: d.visitors || 0, views: d.views || 0, orders: d.orders || 0, revenue: d.revenue || 0 });
  }

  const soldBy = {};
  for (const r of sold.results) soldBy[r.id + "|" + r.size] = r.qty;

  return json({
    days,
    now: { ...tNow.results[0], ...sNow.results[0] },
    prev: { ...tPrev.results[0], ...sPrev.results[0] },
    series,
    referrers: refs.results,
    countries: countries.results,
    devices: devices.results,
    orders: [...toShip.results, ...finished.results].map(o => ({ ...o, items: JSON.parse(o.items), shipping: o.shipping ? JSON.parse(o.shipping) : null })),
    sizes: SIZES,
    sizeLabels: SIZE_LABELS,
    products: shop.products.map(p => ({
      ...p, sold: Object.fromEntries(SIZES.map(z => [z, soldBy[p.id + "|" + z] ?? 0])),
    })),
    site: shop.site,
    signups: signupStats.results[0],
    live: { visitors: live.results[0].n, inCheckout: inCheckout.results[0].n },
    ready: {
      stripe: !!env.STRIPE_SECRET_KEY, webhook: !!env.STRIPE_WEBHOOK_SECRET,
      testMode: /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY || ""),
      ownPassword: !!(await ownPassword(env)),
      email: !!env.RESEND_API_KEY,
      taxError: !!taxError.results[0],
    },
  });
}

/* ---------- Dashboard: products ---------- */
const dollarsToCents = v => Math.round(Number(v) * 100);
const photoPath = v => /^(images\/[\w.\-]+|img\/[0-9a-f]{16,32})$/.test(v || "") ? v : "";

async function saveProduct(request, env) {
  const b = await request.json().catch(() => null) || {};
  const name = clip(b.name, 80).trim();
  const price = dollarsToCents(b.price);
  const was = b.was === "" || b.was == null ? null : dollarsToCents(b.was);
  if (!name) return json({ error: "Give the set a name." }, 400);
  if (!Number.isInteger(price) || price < 50 || price > 10000000) return json({ error: "Enter a price, like 160." }, 400);
  if (was !== null && (!Number.isInteger(was) || was <= price)) {
    return json({ error: "The old price must be higher than the price, or left empty." }, 400);
  }
  const image = photoPath(b.image);
  if (!image) return json({ error: "Add a main photo first." }, 400);
  const pos = /^\d{1,3}% \d{1,3}%$/.test(b.pos || "") ? b.pos : "";

  let id = clip(b.id, 80);
  const existing = id && await env.DB.prepare("SELECT id FROM products WHERE id = ?1").bind(id).first();
  if (id && !existing) return json({ error: "That set no longer exists. Refresh the page." }, 404);
  const statements = [];
  if (!id) {
    id = (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "set") + "-" + randomId(2);
    statements.push(env.DB.prepare(
      `INSERT INTO products (id, name, color, price_cents, was_cents, badge, image, hover, pos, active, sort)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, (SELECT COALESCE(MAX(sort), -1) + 1 FROM products))`)
      .bind(id, name, clip(b.color, 80).trim(), price, was, clip(b.badge, 24).trim(), image, photoPath(b.hover), pos, b.active ? 1 : 0));
  } else {
    statements.push(env.DB.prepare(
      `UPDATE products SET name = ?2, color = ?3, price_cents = ?4, was_cents = ?5, badge = ?6, image = ?7, hover = ?8, pos = ?9, active = ?10
       WHERE id = ?1`)
      .bind(id, name, clip(b.color, 80).trim(), price, was, clip(b.badge, 24).trim(), image, photoPath(b.hover), pos, b.active ? 1 : 0));
  }
  // Only the stock numbers the owner actually changed are sent, along with what the
  // page showed before ("stockWas"). A number is only changed if it is still what
  // the owner was looking at. If a sale or a checkout moved it meanwhile, it is
  // left alone and the dashboard shows the new number and asks them to look again.
  // (So a sale is never overwritten, and pressing Save twice can't add stock twice.)
  const stockAt = [];
  for (const size of SIZES) {
    const qty = b.stock?.[size];
    if (qty === undefined || qty === null || qty === "") continue;
    if (!Number.isInteger(Number(qty)) || qty < 0 || qty > 99999) return json({ error: "Stock must be a whole number, 0 or more." }, 400);
    const was = Number.isInteger(b.stockWas?.[size]) ? b.stockWas[size] : null;
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO stock (product_id, size, qty) VALUES (?1, ?2, ?3)")
      .bind(id, size, was ?? Number(qty)));
    stockAt.push(statements.length);
    statements.push(env.DB.prepare(
      "UPDATE stock SET qty = ?3 WHERE product_id = ?1 AND size = ?2 AND (?4 IS NULL OR qty = ?4)").bind(id, size, Number(qty), was));
  }
  const results = await env.DB.batch(statements);
  const stockMoved = stockAt.some(k => !results[k].meta.changes);
  return json({ ok: true, id, stockMoved });
}

async function moveProduct(request, env) {
  const b = await request.json().catch(() => null) || {};
  const { results } = await env.DB.prepare("SELECT id FROM products ORDER BY sort, rowid").all();
  const ids = results.map(r => r.id), from = ids.indexOf(b.id), to = from + (b.up ? -1 : 1);
  if (from < 0 || to < 0 || to >= ids.length) return json({ ok: true });
  [ids[from], ids[to]] = [ids[to], ids[from]];
  await env.DB.batch(ids.map((id, i) => env.DB.prepare("UPDATE products SET sort = ?1 WHERE id = ?2").bind(i, id)));
  return json({ ok: true });
}

// Past orders keep their own copy of the set's name and price, so they are unaffected.
async function deleteProduct(request, env) {
  const b = await request.json().catch(() => null) || {};
  const id = clip(b.id, 80);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM products WHERE id = ?1").bind(id),
    env.DB.prepare("DELETE FROM stock WHERE product_id = ?1").bind(id),
  ]);
  return json({ ok: true });
}

async function uploadPhoto(request, env) {
  const type = (request.headers.get("Content-Type") || "").split(";")[0];
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) return json({ error: "Photos must be JPG, PNG or WebP." }, 400);
  const data = await request.arrayBuffer();
  if (!data.byteLength) return json({ error: "That photo was empty." }, 400);
  if (data.byteLength > MAX_PHOTO_BYTES) return json({ error: "That photo is too large. Try a smaller one." }, 413);
  const id = randomId(12);
  await env.DB.prepare("INSERT INTO images (id, type, data, ts) VALUES (?1, ?2, ?3, ?4)").bind(id, type, data, now()).run();
  return json({ ok: true, path: "img/" + id });
}

/* ---------- Dashboard: shop settings ---------- */
async function saveSettings(request, env) {
  const b = await request.json().catch(() => null) || {};
  const flat = dollarsToCents(b.flatShipping), free = dollarsToCents(b.freeShippingMin);
  if (!Number.isInteger(flat) || flat < 0 || flat > 100000) return json({ error: "Enter a shipping price, like 10. Use 0 for always free." }, 400);
  if (!Number.isInteger(free) || free < 0 || free > 10000000) return json({ error: "Enter the order amount that gets free shipping, like 150." }, 400);
  const contactEmail = clip(b.contactEmail, 200).trim();
  if (!isEmail(contactEmail)) return json({ error: "Enter a valid contact email." }, 400);
  const site = {
    flatShipping: flat,
    freeShippingMin: free,
    tax: !!b.tax,
    announcements: (Array.isArray(b.announcements) ? b.announcements : [])
      .map(a => clip(a, 80).trim()).filter(Boolean).slice(0, 6),
    contactEmail,
    orderAlerts: !!b.orderAlerts,
    shippedEmails: !!b.shippedEmails,
    returns: clip(b.returns, 20000).trim(),
    privacy: clip(b.privacy, 20000).trim(),
    terms: clip(b.terms, 20000).trim(),
  };
  await env.DB.batch([
    env.DB.prepare("INSERT INTO settings (key, value) VALUES ('site', ?1) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(site)),
    env.DB.prepare("DELETE FROM settings WHERE key = 'tax_error'"),
  ]);
  return json({ ok: true });
}

/* ---------- Dashboard: orders ---------- */
async function markShipped(request, env) {
  const body = await request.json().catch(() => null);
  const id = clip(body?.id, 64);
  const tracking = body?.shipped ? clip(body.tracking, 80).trim() || null : null;
  const res = await env.DB.prepare("UPDATE orders SET shipped_at = ?1, tracking = ?2 WHERE id = ?3 AND status = 'paid'")
    .bind(body?.shipped ? now() : null, tracking, id).run();
  if (!res.meta.changes) return json({ error: "Order not found." }, 404);
  if (!body.shipped) return json({ ok: true });

  // Tell the customer it's on the way.
  const { site } = await loadShop(env);
  if (!site.shippedEmails) return json({ ok: true, email: { sent: false, why: "Shipping emails are switched off in Settings." } });
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?1").bind(id).first();
  const email = await sendEmail(env, site, order.origin || new URL(request.url).origin, order.email,
    "Your Billionaire Garments order is on its way", [
      `Hi ${(order.name || "").split(" ")[0] || "there"},`, "",
      `Good news: your order ${orderNo(order.id)} has shipped.`, "",
      "What's in it:", ...itemLines(JSON.parse(order.items)), "",
      tracking ? `Tracking number: ${tracking}` : null,
      tracking ? "" : null,
      "Shipping to:", ...addressLines(order.shipping ? JSON.parse(order.shipping) : null), "",
      `Questions? Just reply to this email or write to ${site.contactEmail}.`, "",
      "Thank you,", "Billionaire Garments",
    ]);
  return json({ ok: true, email });
}

// The owner refunded an order in Stripe (or it was returned): take it off the
// to-ship list and out of the sales figures. Does not move any money itself.
async function cancelOrder(request, env) {
  const body = await request.json().catch(() => null);
  const id = clip(body?.id, 64);
  const order = await env.DB.prepare("SELECT items FROM orders WHERE id = ?1 AND status = 'paid'").bind(id).first();
  if (!order) return json({ error: "Order not found." }, 404);
  const results = await env.DB.batch([
    ...(body?.restock ? JSON.parse(order.items) : []).map(i => env.DB.prepare(
      `UPDATE stock SET qty = qty + ?1 WHERE product_id = ?2 AND size = ?3
       AND EXISTS (SELECT 1 FROM orders WHERE id = ?4 AND status = 'paid')`).bind(i.qty, i.id, i.size, id)),
    env.DB.prepare("UPDATE orders SET status = 'refunded' WHERE id = ?1 AND status = 'paid'").bind(id),
  ]);
  if (!results.at(-1).meta.changes) return json({ error: "Order not found." }, 404);
  return json({ ok: true });
}

async function signupsCsv(request, env) {
  const { results } = await env.DB.prepare("SELECT email, ts FROM signups WHERE email != '' ORDER BY ts DESC").all();
  // Quote every cell, and defuse anything a spreadsheet would run as a formula.
  const cell = v => `"${String(v).replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`;
  const rows = results.map(r => [r.email, new Date(r.ts * 1000).toISOString().slice(0, 10)].map(cell).join(","));
  return new Response(["email,joined", ...rows].join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="billionaire-garments-signups.csv"',
      "Cache-Control": "no-store",
    },
  });
}
