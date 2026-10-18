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
    stock: { S: 6, M: 10, L: 8, XL: 3, "2XL": 0 } },
  { id: "royal-set",     name: "Royal Script Sweatsuit",  color: "Black / Purple Script", price: 160, was: null, badge: "New",         image: "images/purple-back.jpg", hover: "images/purple-side.jpg",
    stock: { S: 4, M: 7, L: 2, XL: 5, "2XL": 2 } },
  { id: "crimson-set",   name: "Crimson Logo Sweatsuit",  color: "Black / Red Logo",      price: 160, was: null, badge: "New",         image: "images/embroidery.jpg",
    stock: { S: 0, M: 5, L: 9, XL: 6, "2XL": 1 } },
  { id: "midnight-set",  name: "Midnight Sweatsuit",      color: "All Black",             price: 150, was: null, badge: "",            image: "images/gate.jpg",        hover: "images/dock.jpg", pos: "50% 45%",
    stock: { S: 3, M: 0, L: 0, XL: 2, "2XL": 4 } },
  { id: "lakeside-set",  name: "Lakeside Sweatsuit",      color: "Black / White Script",  price: 150, was: null, badge: "",            image: "images/purple-side.jpg", hover: "images/dock.jpg",
    stock: { S: 0, M: 0, L: 0, XL: 0, "2XL": 0 } },
];

const SIZES = ["S", "M", "L", "XL", "2XL"];
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

function availabilityText(p) {
  const size = selectedSize[p.id];
  if (!totalStock(p)) return `<span class="out">Sold out in all sizes</span>`;
  if (!size) {
    const open = SIZES.filter(s => stockOf(p, s) > 0).length;
    return `${open} of ${SIZES.length} sizes available`;
  }
  const n = stockOf(p, size);
  if (n <= LOW_STOCK) return `<span class="low">Size ${size}: only ${n} left</span>`;
  return `<span class="ok">Size ${size}: in stock</span>`;
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
          return `<button data-size="${s}" class="${cls}" ${n ? "" : "disabled"} aria-label="${s}${n ? "" : " (sold out)"}">${s}</button>`;
        }).join("")}
      </div>
      <p class="availability" aria-live="polite">${availabilityText(p)}</p>
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
  const p = PRODUCTS.find(x => x.id === id);

  const sizeBtn = e.target.closest("[data-size]");
  if (sizeBtn) {
    $$("[data-size]", card).forEach(b => b.classList.toggle("is-selected", b === sizeBtn));
    selectedSize[id] = sizeBtn.dataset.size;
    $(".availability", card).innerHTML = availabilityText(p);
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
$("#newsletter").addEventListener("submit", e => {
  e.preventDefault();
  $(".form-note", e.target).textContent = "You're on the list. Welcome to the club.";
  e.target.reset();
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
