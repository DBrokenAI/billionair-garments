# Billionaire Garments

A single-page storefront for Billionaire Garments, a clothing brand selling embroidered heavyweight sweatsuit sets. It is a static front end built with plain HTML, CSS and JavaScript: shoppers can browse the sets, pick a size, and build a bag that persists between visits.

**Live site:** https://dbrokenai.github.io/billionair-garments/

## What it does

- **Product grid rendered from data.** The five sets are defined in one `PRODUCTS` array in `script.js` (name, colorway, price, previous price, badge, photos, stock per size). Cards are generated from it, so changing the catalogue means editing that list only.
- **Per-size stock.** Each size button shows its own count: "N in stock", "Only N left" at three or fewer, or a disabled, struck-through "Sold out". A set with no stock in any size gets a "Sold Out" badge, a greyed photo and a disabled button.
- **Cart drawer.** A slide-in bag with quantity controls, remove, running subtotal and a count badge in the header. It closes on overlay click or Escape.
- **Stock-aware cart rules.** Quantities cannot exceed the stock for that size, whether added from the grid or incremented in the bag.
- **Persistent cart.** The bag is saved to `localStorage`. On load it is reconciled against the current catalogue: removed products are dropped and quantities are capped at current stock.
- **Hero slideshow.** Three crossfading slides with a slow zoom, dot navigation and autoplay that restarts when a dot is clicked.
- **Logo intro.** A CSS-only intro reveals the logo, then hands off to the hero; the slideshow waits on the first slide until the intro finishes.
- **Sign-up form.** Accepts an email, a phone number, or both, with validation that at least one is given and that a phone number has at least ten digits.
- **Feedback details.** Toast messages for cart actions, a shake on the size selector if "Add to Bag" is pressed with no size chosen, and a sale price shown with the saving calculated from the data.

## How it is built

- **No framework, no build step, no dependencies.** Three source files: `index.html`, `styles.css`, `script.js`. The only external request is Google Fonts (Cormorant Garamond, Inter, Pinyon Script).
- **Event delegation.** One click listener on the grid and one on the cart list handle all size, add, quantity and remove actions, so re-rendering does not need listeners re-attached.
- **Theming with CSS custom properties.** Colours are tokens on `:root`. A `.leather` class redefines the same tokens for dark surfaces, so the header, footer, cart drawer and intro reuse the same component styles with light text.
- **Leather texture without image files.** The dark surfaces use inline SVG `feTurbulence` noise as data URIs, layered with radial gradients.
- **Responsive layout.** Flexbox grid of three, two or one card per row at 860px and 520px breakpoints, with `clamp()` for fluid type and spacing and `svh` units for the hero height.
- **Motion handled with care.** Scroll reveals use `IntersectionObserver` with a staggered delay per row. `prefers-reduced-motion` disables animations and transitions in CSS, and an inline script skips the logo intro entirely for those users.
- **Accessibility basics.** ARIA labels on icon buttons and inputs, `aria-live` on the form message, `role="status"` on the toast, `aria-hidden` toggled on the cart drawer, and descriptive alt text generated for product photos.
- **Lazy-loaded product images** and a hover photo swap on cards that define a second image.

## Run it locally

There is nothing to install. Clone the repo and open `index.html` in a browser, or serve the folder with any static server:

```sh
git clone https://github.com/DBrokenAI/billionair-garments.git
cd billionair-garments
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Project structure

```
index.html    Page markup: intro, announcement bar, header, hero, shop, footer, cart drawer
styles.css    All styling: tokens, leather theme, layout, animations, responsive rules
script.js     Product data, grid and cart rendering, slideshow, form validation, scroll reveals
images/       Logo and product photography
```

## Status and limitations

This is a front end only. There is no server, database or payment integration.

- **Checkout is not connected.** The button shows a "coming soon" message; the code marks where a payment provider would be wired in.
- **The sign-up form does not send data anywhere.** It validates input and shows a confirmation, but nothing is stored or transmitted.
- **Stock counts are hard-coded** in `script.js` and do not change when items are added to the bag or between visitors.
- **The cart lives in the browser** (`localStorage`), so it is per device and per browser.
- There are no automated tests.
