/* ============================================
   Billionaire Garments — site behavior
   ============================================
   To add or edit products, change the PRODUCTS list below.
   image: main photo   hover: photo shown on mouse-over (optional)
   pos:   which part of the photo to focus on (optional, e.g. "50% 80%")
   stock: how many of each size are left (0 = sold out)
*/

const PRODUCTS = [
  { id: "signature-set", name: "Signature Sweatsuit",     color: "Black / White Script",  price: 160, was: 200,  badge: "Best Seller", image: "images/dock.jpg",        hover: "images/gate.jpg",
    stock: { "S/M": 9, "L/XL": 4 } },
  { id: "royal-set",     name: "Royal Script Sweatsuit",  color: "Black / Purple Script", price: 160, was: null, badge: "New",         image: "images/purple-back.jpg", hover: "images/purple-side.jpg",
    stock: { "S/M": 6, "L/XL": 2 } },
  { id: "crimson-set",   name: "Crimson Logo Sweatsuit",  color: "Black / Red Logo",      price: 160, was: null, badge: "New",         image: "images/embroidery.jpg",
    stock: { "S/M": 3, "L/XL": 8 } },
  { id: "midnight-set",  name: "Midnight Sweatsuit",      color: "All Black",             price: 150, was: null, badge: "",            image: "images/gate.jpg",        hover: "images/dock.jpg", pos: "50% 45%",
    stock: { "S/M": 0, "L/XL": 5 } },
  { id: "lakeside-set",  name: "Lakeside Sweatsuit",      color: "Black / White Script",  price: 150, was: null, badge: "",            image: "images/purple-side.jpg", hover: "images/dock.jpg",
    stock: { "S/M": 0, "L/XL": 0 } },
];

const SIZES = ["S/M", "L/XL"];
const SIZE_LABELS = { "S/M": "Small / Medium", "L/XL": "Large / X-Large" };
const LOW_STOCK = 3;   // show "Only X left" at or below this
const CART_KEY = "bg-cart";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const money = n => "$" + n.toLocaleString("en-US");
const stockOf = (p, size) => p.stock[size] || 0;
const totalStock = p => SIZES.reduce((n, s) => n + stockOf(p, s), 0);

function media(p, withHover = false) {
  const pos = p.pos ? ` style="object-position:${p.pos}"` : "";
  return `<img src="${p.image}" alt="${p.name} — ${p.color}" loading="lazy"${pos}>` +
    (withHover && p.hover ? `<img class="alt" src="${p.hover}" alt="" loading="lazy">` : "");
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
  return `
    <article class="card ${soldOut ? "is-sold-out" : ""}" data-id="${p.id}">
      <div class="card-media">
        ${badge ? `<span class="badge">${badge}</span>` : ""}
        ${media(p, true)}
      </div>
      <h3>${p.name}</h3>
      <p class="color">${p.color}</p>
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
      <button class="btn btn-accent btn-block add" data-add="${p.id}" ${soldOut ? "disabled" : ""}>${soldOut ? "Sold Out" : "Add to Bag"}</button>
    </article>`;
}

function renderProducts() {
  grid.innerHTML = PRODUCTS.map(renderCard).join("");
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
// drop items no longer sold, and cap quantities at what's in stock
cart = cart.filter(l => PRODUCTS.some(p => p.id === l.id));
cart.forEach(l => l.qty = Math.min(l.qty, stockOf(PRODUCTS.find(p => p.id === l.id), l.size)));
cart = cart.filter(l => l.qty > 0);

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
          <h4>${p.name}</h4>
          <p class="meta">${p.color} · ${l.size}</p>
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

$(".checkout").addEventListener("click", () => {
  if (!cart.length) return toast("Your bag is empty");
  // TODO: connect to Shopify / Stripe / Square checkout here.
  toast("Checkout coming soon — contact us to complete your order");
});

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
$("#newsletter").addEventListener("submit", e => {
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
  // TODO: send { email, phone } to your email/SMS service (e.g. Klaviyo, Mailchimp, Formspree).
  const via = email && phone ? "by email and text" : email ? "by email" : "by text";
  note.textContent = `You're on the list, we'll reach you ${via}. Welcome to the club.`;
  form.reset();
});

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $(".toast");
  t.textContent = msg;
  t.classList.add("is-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("is-show"), 2400);
}

/* ---------- Init ---------- */
$("#year").textContent = new Date().getFullYear();
renderProducts();
renderCart();

/* ---------- Scroll reveals ---------- */
const revealer = new IntersectionObserver(entries => entries.forEach(en => {
  if (!en.isIntersecting) return;
  en.target.classList.add("is-in");
  revealer.unobserve(en.target);
}), { rootMargin: "0px 0px -10% 0px" });
$$(".section-head, .card").forEach(el => { el.classList.add("reveal-up"); revealer.observe(el); });
$$(".card").forEach((el, i) => el.style.transitionDelay = (i % 3) * 0.12 + "s"); // stagger a row
