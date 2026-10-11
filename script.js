/* ============================================
   Billionaire Garments — site behavior
   ============================================
   To add or edit products, change the PRODUCTS list below.
   image: main photo   hover: photo shown on mouse-over (optional)
   pos:   which part of the photo to focus on (optional, e.g. "50% 80%")
   category: "sets", "hoodies" or "bottoms"
*/

const PRODUCTS = [
  { id: "signature-set",   name: "Signature Sweatsuit",    color: "Black / White Script",  category: "sets",    price: 160, was: 200, badge: "Best Seller", image: "images/dock.jpg",        hover: "images/gate.jpg" },
  { id: "royal-set",       name: "Royal Script Sweatsuit", color: "Black / Purple Script", category: "sets",    price: 160, was: null, badge: "New",        image: "images/purple-back.jpg", hover: "images/purple-side.jpg" },
  { id: "signature-hoodie",name: "Signature Hoodie",       color: "Black / White Script",  category: "hoodies", price: 95,  was: null, badge: "",           image: "images/gate.jpg",        hover: "images/dock.jpg", pos: "50% 45%" },
  { id: "royal-hoodie",    name: "Royal Script Hoodie",    color: "Black / Purple Script", category: "hoodies", price: 95,  was: 120,  badge: "Only 4 Left", low: true, image: "images/purple-side.jpg", hover: "images/purple-back.jpg" },
  { id: "red-sweatpants",  name: "Embroidered Sweatpants", color: "Black / Red Logo",      category: "bottoms", price: 75,  was: null, badge: "New",        image: "images/embroidery.jpg" },
  { id: "signature-pants", name: "Signature Sweatpants",   color: "Black",                 category: "bottoms", price: 75,  was: 90,   badge: "",           image: "images/dock.jpg", pos: "50% 85%", hover: "images/gate.jpg" },
];

const SIZES = ["S", "M", "L", "XL", "2XL"];
const CART_KEY = "bg-cart";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const money = n => "$" + n.toLocaleString("en-US");

function media(p, withHover = false) {
  const pos = p.pos ? ` style="object-position:${p.pos}"` : "";
  return `<img src="${p.image}" alt="${p.name} — ${p.color}" loading="lazy"${pos}>` +
    (withHover && p.hover ? `<img class="alt" src="${p.hover}" alt="" loading="lazy">` : "");
}

/* ---------- Product grid ---------- */
const grid = $("#product-grid");
const selectedSize = {};

function renderProducts(filter = "all") {
  const list = PRODUCTS.filter(p => filter === "all" || p.category === filter);
  grid.innerHTML = list.map((p, i) => `
    <article class="card" style="animation-delay:${i * 60}ms" data-id="${p.id}">
      <div class="card-media">
        ${p.badge ? `<span class="badge ${p.low ? "low" : ""}">${p.badge}</span>` : ""}
        ${media(p, true)}
        <button class="btn btn-accent quick-add" data-add="${p.id}">Add to Bag</button>
      </div>
      <h3>${p.name}</h3>
      <p class="color">${p.color}</p>
      <p class="price">
        <strong>${money(p.price)}</strong>
        ${p.was ? `<s>${money(p.was)}</s><span class="save">Save ${money(p.was - p.price)}</span>` : ""}
      </p>
      <div class="sizes" aria-label="Choose size">
        ${SIZES.map(s => `<button data-size="${s}" class="${selectedSize[p.id] === s ? "is-selected" : ""}">${s}</button>`).join("")}
      </div>
    </article>`).join("");
}

function setFilter(filter) {
  $$(".filters button").forEach(b => b.classList.toggle("is-active", b.dataset.filter === filter));
  renderProducts(filter);
}

$(".filters").addEventListener("click", e => {
  const btn = e.target.closest("button[data-filter]");
  if (btn) setFilter(btn.dataset.filter);
});

$$("[data-filter-link]").forEach(a =>
  a.addEventListener("click", () => setFilter(a.dataset.filterLink))
);

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
cart = cart.filter(l => PRODUCTS.some(p => p.id === l.id)); // drop items no longer sold

function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {}
}

function addToCart(id, size) {
  const line = cart.find(l => l.id === id && l.size === size);
  if (line) line.qty++;
  else cart.push({ id, size, qty: 1 });
  saveCart();
  renderCart();
  const p = PRODUCTS.find(x => x.id === id);
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
  if (t.dataset.inc) cart[t.dataset.inc].qty++;
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
document.addEventListener("keydown", e => { if (e.key === "Escape") { closeCart(); closeMenu(); } });

$(".checkout").addEventListener("click", () => {
  if (!cart.length) return toast("Your bag is empty");
  // TODO: connect to Shopify / Stripe / Square checkout here.
  toast("Checkout coming soon — contact us to complete your order");
});

/* ---------- Mobile menu ---------- */
const menuBtn = $(".menu-toggle"), menu = $(".mobile-menu");
function closeMenu() { menu.classList.remove("is-open"); menuBtn.setAttribute("aria-expanded", "false"); menu.setAttribute("aria-hidden", "true"); }
menuBtn.addEventListener("click", () => {
  const open = !menu.classList.contains("is-open");
  menu.classList.toggle("is-open", open);
  menuBtn.setAttribute("aria-expanded", open);
  menu.setAttribute("aria-hidden", !open);
});
$$("a", menu).forEach(a => a.addEventListener("click", closeMenu));

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
autoplay();

/* ---------- Forms ---------- */
$("#contact-form").addEventListener("submit", e => {
  e.preventDefault();
  // TODO: connect to Formspree, Netlify Forms, or an email service.
  $(".form-note", e.target).textContent = "Thank you — we'll be in touch within 24 hours.";
  e.target.reset();
});
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


/* ---------- Scroll reveals ---------- */
const REVEALS = {
  "reveal-up": ".section-head, .about-grid > div:last-child, .banner, .contact-card",
  "reveal-curtain": ".collection, .about-img",
};
// We watch each item's parent, because a fully clipped item never counts as "on screen".
const revealGroups = new Map();
const revealer = new IntersectionObserver(entries => entries.forEach(en => {
  if (!en.isIntersecting) return;
  revealGroups.get(en.target).forEach(el => el.classList.add("is-in"));
  revealer.unobserve(en.target);
}), { rootMargin: "0px 0px -12% 0px" });
Object.entries(REVEALS).forEach(([cls, sel]) => $$(sel).forEach(el => {
  const parent = el.parentElement;
  const i = [...parent.children].indexOf(el);
  el.classList.add(cls);
  el.style.transitionDelay = (i % 4) * 0.12 + "s"; // stagger items in a row
  if (!revealGroups.has(parent)) { revealGroups.set(parent, []); revealer.observe(parent); }
  revealGroups.get(parent).push(el);
}));

/* ---------- Init ---------- */
$("#year").textContent = new Date().getFullYear();
renderProducts();
renderCart();
