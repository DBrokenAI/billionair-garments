/* ============================================
   Billionaire Garments — sizes and starting settings
   ============================================
   Products, prices, photos and stock are NOT in the code: the owner edits
   them in the dashboard (/admin) and they live in the database.

   What is here:
   - the sizes every set is sold in
   - the shop settings used until the owner saves their own in the dashboard
*/

export const SIZES = ["S/M", "L/XL"];
export const SIZE_LABELS = { "S/M": "Small / Medium", "L/XL": "Large / X-Large" };

export const SITE_DEFAULTS = {
  freeShippingMin: 15000,     // cents: orders at or above this ship free
  flatShipping: 1000,         // cents: shipping charged below that
  tax: false,                 // add sales tax at checkout (needs Stripe Tax set up in Stripe)
  announcements: [            // the scrolling bar at the top of the shop
    "Free shipping on orders over $150",
    "Heavyweight embroidered fleece",
    "Guaranteed on-time shipping",
  ],
  contactEmail: "info@billionairegarments.com",   // shown to customers; order alerts go here too
  orderAlerts: true,          // email the owner when an order is paid
  shippedEmails: true,        // email the customer when an order is marked shipped
  returns: "",                // policy pages: plain text, blank = page and footer link hidden
  terms: "",
  privacy: `This policy explains what information Billionaire Garments collects when you use this website and what we do with it.

What we collect
When you place an order we receive your name, email address, phone number, shipping address and what you bought. Payments are handled by Stripe. Your card details go directly to Stripe and are never seen or stored by us.
If you join our list, we keep the email address or phone number you give us.
We count visits to the site to understand how the shop is doing. This uses no cookies and does not store your IP address, so it cannot identify you.

How we use it
We use order details to deliver your order and to contact you about it. We use list sign-ups to send news about drops and offers. You can ask to be removed at any time.

Who we share it with
We share order details only with the companies that help us run the shop: Stripe for payments, our website host, our email provider, and the carrier that delivers your order. We do not sell your information.

Your choices
To see, correct or delete the information we hold about you, or to leave the list, email us at the address at the bottom of this site.`,
};
