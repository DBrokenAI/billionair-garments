/* ============================================
   Billionaire Garments — shop page behavior
   ============================================
   Products, prices, photos, stock and the top-bar messages are edited by
   the owner at /admin. This file loads them from the server and runs the page.
*/

let PRODUCTS = [];
let SIZES = [];
let SIZE_LABELS = {};
const LOW_STOCK = 3;   // show "Only X left" at or below this
const CART_KEY = "bg-cart";
const PENDING_KEY = "bg-pending";   // the checkout this shopper last started

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const money = n => "$" + n.toLocaleString("en-US");
const stockOf = (p, size) => p.stock[size] || 0;
const totalStock = p => SIZES.reduce((n, s) => n + stockOf(p, s), 0);

// Names and colours are typed by the owner, so make them safe to place in the page.
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function media(p, withHover = false) {
  const pos = p.pos ? ` style="object-position:${esc(p.pos)}"` : "";
  return `<img src="${esc(p.image)}" alt="${esc(p.name)}${p.color ? " — " + esc(p.color) : ""}" loading="lazy"${pos}>` +
    (withHover && p.hover ? `<img class="alt" src="${esc(p.hover)}" alt="" loading="lazy">` : "");
}

// Top-bar messages, contact email and policy links, as set in the dashboard.
function renderSite(site) {
  if (!site) return;
  const bar = $(".announce");
  if (site.announcements.length) {
    const once = site.announcements.map(a => `<span>${esc(a)}</span><span>◆</span>`).join("");
    $(".announce-track").innerHTML = once + once;   // doubled so the scroll loops seamlessly
    bar.hidden = false;
  } else bar.hidden = true;
  const mail = $("#contact-email");
  mail.textContent = site.contactEmail;
  mail.href = "mailto:" + site.contactEmail;
  $("#policy-links").innerHTML = site.policies
    .map(p => `<a href="policy?p=${esc(p.key)}">${esc(p.title)}</a>`).join("");
}

/* ---------- Server calls ---------- */
async function post(path, data) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, ...body };
}

// Anonymous visit counting for the owner's dashboard (no cookies).
function track(type) {
  try {
    fetch("/api/t", {
      method: "POST", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ t: type, p: location.pathname, r: document.referrer, s: new URLSearchParams(location.search).get("utm_source") || "" }),
    }).catch(() => {});
  } catch {}
}

async function loadProducts() {
  const res = await fetch("/api/products");
  if (!res.ok) throw new Error("products " + res.status);
  const data = await res.json();
  PRODUCTS = data.products;
  SIZES = data.sizes;
  SIZE_LABELS = data.sizeLabels;
  renderSite(data.site);
  // drop bag items no longer sold, and cap quantities at what's in stock
  cart = cart.filter(l => PRODUCTS.some(p => p.id === l.id));
  cart.forEach(l => l.qty = Math.min(l.qty, stockOf(PRODUCTS.find(p => p.id === l.id), l.size)));
  cart = cart.filter(l => l.qty > 0);
  saveCart();
  renderProducts();
  renderCart();
}

/* ---------- Product grid ---------- */
const grid = $("#product-grid");
const selectedSize = {};

function stockText(n) {
  if (!n) return "Sold out";
  return n <= LOW_STOCK ? `Only ${n} left` : `${n} in stock`;
}

function renderCard(p) {
  const soldOut = !totalStock(p);
  const badge = soldOut ? "Sold Out" : p.badge;
  if (selectedSize[p.id] && !stockOf(p, selectedSize[p.id])) delete selectedSize[p.id];
  return `
    <article class="card ${soldOut ? "is-sold-out" : ""}" data-id="${esc(p.id)}">
      <div class="card-media">
        ${badge ? `<span class="badge">${esc(badge)}</span>` : ""}
        ${media(p, true)}
      </div>
      <h3>${esc(p.name)}</h3>
      <p class="color">${esc(p.color)}</p>
      <p class="price">
        <strong>${money(p.price)}</strong>
        ${p.was ? `<s>${money(p.was)}</s><span class="save">Save ${money(p.was - p.price)}</span>` : ""}
      </p>
      <div class="sizes" role="group" aria-label="Choose size">
        ${SIZES.map(s => {
          const n = stockOf(p, s);
          const cls = [n ? "" : "is-out", n && n <= LOW_STOCK ? "is-low" : "", selectedSize[p.id] === s ? "is-selected" : ""].join(" ").trim();
          return `<button data-size="${s}" class="${cls}" ${n ? "" : "disabled"}>
            <span class="size-name">${SIZE_LABELS[s]}</span>
            <span class="size-stock">${stockText(n)}</span>
          </button>`;
        }).join("")}
      </div>
      <button class="btn btn-accent btn-block add" data-add="${esc(p.id)}" ${soldOut ? "disabled" : ""}>${soldOut ? "Sold Out" : "Add to Bag"}</button>
    </article>`;
}

function renderProducts() {
  grid.innerHTML = PRODUCTS.length
    ? PRODUCTS.map(renderCard).join("")
    : `<p class="muted shop-down">New sets are on the way. Join the list below to hear first.</p>`;
}

grid.addEventListener("click", e => {
  const card = e.target.closest(".card");
  if (!card) return;
  const id = card.dataset.id;

  const sizeBtn = e.target.closest("[data-size]");
  if (sizeBtn) {
    $$("[data-size]", card).forEach(b => b.classList.toggle("is-selected", b === sizeBtn));
    selectedSize[id] = sizeBtn.dataset.size;
    return;
  }

  if (e.target.closest("[data-add]")) {
    const size = selectedSize[id];
    if (!size) {
      toast("Please pick a size first");
      $(".sizes", card).animate(
        [{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }],
        { duration: 300 }
      );
      return;
    }
    addToCart(id, size);
  }
});

/* ---------- Cart ---------- */
let cart = [];
try { cart = JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { cart = []; }

function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {}
}

function addToCart(id, size) {
  const p = PRODUCTS.find(x => x.id === id);
  const line = cart.find(l => l.id === id && l.size === size);
  if ((line ? line.qty : 0) >= stockOf(p, size)) return toast(`No more ${size} left in stock`);
  if (line) line.qty++;
  else cart.push({ id, size, qty: 1 });
  saveCart();
  renderCart();
  toast(`${p.name} (${size}) added to bag`);
  track("add");
}

function renderCart() {
  const count = cart.reduce((n, l) => n + l.qty, 0);
  $(".cart-count").textContent = count;

  const items = $(".cart-items");
  if (!cart.length) {
    items.innerHTML = `<p class="cart-empty">Your bag is empty.</p>`;
  } else {
    items.innerHTML = cart.map((l, i) => {
      const p = PRODUCTS.find(x => x.id === l.id);
      return `
      <div class="cart-item">
        <div class="cart-thumb">${media(p)}</div>
        <div>
          <h4>${esc(p.name)}</h4>
          <p class="meta">${esc(p.color)}${p.color ? " · " : ""}${l.size}</p>
          <div class="qty">
            <button data-dec="${i}" aria-label="Decrease quantity">−</button>
            <span>${l.qty}</span>
            <button data-inc="${i}" aria-label="Increase quantity">+</button>
          </div>
        </div>
        <div style="text-align:right">
          <strong>${money(p.price * l.qty)}</strong><br>
          <button class="remove" data-remove="${i}">Remove</button>
        </div>
      </div>`;
    }).join("");
  }
  const total = cart.reduce((sum, l) => sum + PRODUCTS.find(x => x.id === l.id).price * l.qty, 0);
  $(".cart-total strong").textContent = money(total);
}

$(".cart-items").addEventListener("click", e => {
  const t = e.target;
  if (t.dataset.inc) {
    const l = cart[t.dataset.inc];
    if (l.qty >= stockOf(PRODUCTS.find(p => p.id === l.id), l.size)) return toast(`No more ${l.size} left in stock`);
    l.qty++;
  }
  else if (t.dataset.dec) { const l = cart[t.dataset.dec]; l.qty--; if (l.qty < 1) cart.splice(t.dataset.dec, 1); }
  else if (t.dataset.remove) cart.splice(t.dataset.remove, 1);
  else return;
  saveCart();
  renderCart();
});

const cartEl = $(".cart"), overlay = $(".overlay");
function openCart() { cartEl.classList.add("is-open"); overlay.classList.add("is-open"); cartEl.setAttribute("aria-hidden", "false"); }
function closeCart() { cartEl.classList.remove("is-open"); overlay.classList.remove("is-open"); cartEl.setAttribute("aria-hidden", "true"); }
$(".cart-btn").addEventListener("click", openCart);
$(".cart-close").addEventListener("click", closeCart);
overlay.addEventListener("click", closeCart);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeCart(); });

/* ---------- Checkout (Stripe) ----------
   The server checks the bag, holds the stock, and returns the address of
   Stripe's secure payment page. Card details never touch this site. */
const checkoutBtn = $(".checkout");
checkoutBtn.addEventListener("click", async () => {
  if (!cart.length) return toast("Your bag is empty");
  checkoutBtn.disabled = true;
  checkoutBtn.textContent = "One moment…";
  track("checkout");
  let res;
  // "replaces" = a checkout this shopper started earlier and left, so its held stock is freed first.
  let earlier = null;
  try { earlier = localStorage.getItem(PENDING_KEY); } catch {}
  try { res = await post("/api/checkout", { items: cart, replaces: earlier }); }
  catch { res = { error: "No connection. Please try again." }; }
  if (res.url) {
    try { localStorage.setItem(PENDING_KEY, res.order); } catch {}
    return void (location.href = res.url);
  }

  checkoutBtn.disabled = false;
  checkoutBtn.textContent = "Checkout";
  toast(res.error || "We couldn't start checkout. Please try again.", 5000);
  if (res.stock) loadProducts().catch(() => {});   // someone else bought it first: show fresh stock
});

// Coming back from Stripe's page: via "back" (bfcache) or the cancel link.
window.addEventListener("pageshow", e => {
  checkoutBtn.disabled = false;
  checkoutBtn.textContent = "Checkout";
  if (e.persisted) loadProducts().catch(() => {});
});

async function handleCancelledCheckout() {
  const order = new URLSearchParams(location.search).get("cancelled");
  if (!order) return;
  history.replaceState(null, "", location.pathname);
  await post("/api/checkout/cancel", { order }).catch(() => {});   // frees the held stock straight away
  try { localStorage.removeItem(PENDING_KEY); } catch {}
}

/* ---------- Intro → hero slideshow ---------- */
// The slideshow holds on slide 1 until the logo intro hands off to it.
const INTRO_MS = 2500;
function startHero() {
  document.documentElement.classList.add("intro-done");
  autoplay();
}

/* ---------- Hero slider ---------- */
const slides = $$(".slide"), dots = $$(".hero-dots button");
let current = 0, timer;
function goTo(i) {
  current = (i + slides.length) % slides.length;
  slides.forEach((s, k) => s.classList.toggle("is-active", k === current));
  dots.forEach((d, k) => d.classList.toggle("is-active", k === current));
}
function autoplay() { clearInterval(timer); timer = setInterval(() => goTo(current + 1), 6500); }
dots.forEach((d, i) => d.addEventListener("click", () => { goTo(i); autoplay(); }));

if (document.documentElement.classList.contains("no-intro")) startHero();
else setTimeout(startHero, INTRO_MS);

/* ---------- Newsletter ---------- */
// Customers can join by email, by phone, or both — at least one is required.
$("#newsletter").addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.target, note = $(".form-note", form);
  const email = form.email.value.trim(), phone = form.phone.value.trim();
  if (!email && !phone) {
    note.textContent = "Enter an email, a phone number, or both.";
    return;
  }
  if (phone && phone.replace(/\D/g, "").length < 10) {
    note.textContent = "Please enter a full phone number.";
    return;
  }
  let res;
  try { res = await post("/api/signup", { email, phone }); }
  catch { res = { error: "No connection. Please try again." }; }
  if (!res.ok) {
    note.textContent = res.error || "That didn't go through. Please try again.";
    return;
  }
  const via = email && phone ? "by email and text" : email ? "by email" : "by text";
  note.textContent = `You're on the list, we'll reach you ${via}. Welcome to the club.`;
  form.reset();
});

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg, ms = 2400) {
  const t = $(".toast");
  t.textContent = msg;
  t.classList.add("is-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("is-show"), ms);
}

/* ---------- Init ---------- */
$("#year").textContent = new Date().getFullYear();
track("view");

(async () => {
  const cameBack = new URLSearchParams(location.search).has("cancelled");
  await handleCancelledCheckout();
  try {
    await loadProducts();
  } catch {
    grid.innerHTML = `<p class="muted shop-down">The shop is taking a moment to load. Please refresh the page.</p>`;
    return;
  }
  if (cameBack && cart.length) openCart();

  /* ---------- Scroll reveals ---------- */
  const revealer = new IntersectionObserver(entries => entries.forEach(en => {
    if (!en.isIntersecting) return;
    en.target.classList.add("is-in");
    revealer.unobserve(en.target);
  }), { rootMargin: "0px 0px -10% 0px" });
  $$(".section-head, .card").forEach(el => { el.classList.add("reveal-up"); revealer.observe(el); });
  $$(".card").forEach((el, i) => el.style.transitionDelay = (i % 3) * 0.12 + "s"); // stagger a row
})();
