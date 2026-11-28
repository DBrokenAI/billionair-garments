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
    "Free shipping on orders of $150 or more",
    "Heavyweight embroidered fleece",
  ],
  contactEmail: "info@billionairegarments.com",   // shown to customers; order alerts go here too
  orderAlerts: true,          // email the owner when an order is paid
  shippedEmails: true,        // email the customer when an order is marked shipped
  // Policy pages: plain text. A blank one hides that page and its footer link.
  returns: `Last updated November 27, 2026

All sales are final
Every set is checked before it ships. Because of that, and because our pieces are made in limited runs, we do not accept returns or exchanges for change of mind, or for a size that did not fit. Please check the size you choose before you order. If you are unsure which size to pick, email us first and we will help.

If your order arrives damaged, faulty or wrong
We will put it right. Email us within 7 days of delivery with your order number and a photo of the problem.
Once we have confirmed it, you can choose a replacement of the same item, or store credit for the amount you paid for it. If we cannot replace the item, we will refund what you paid for it.
We pay the return shipping. We will email you a prepaid label; please do not send anything back before you hear from us.
Items must come back unworn and unwashed, with any tags still attached.

Orders that do not arrive
If tracking shows your order as delivered and you cannot find it, or it has not moved for 7 days, email us and we will look into it with the carrier.

Cancelling an order
We can cancel an order and refund it in full if you email us before it ships. Once it has shipped, it cannot be cancelled.

How to reach us
Email us at the address at the bottom of this site and include your order number. We reply within 2 business days.`,
  terms: `Last updated November 27, 2026

These terms apply to every order placed on this website. By placing an order you agree to them.

Who we are
This website is run by Billionaire Garments. You can reach us at the email address at the bottom of this site.

Products and prices
Prices are in US dollars. Shipping, and sales tax where it applies, are shown at checkout before you pay.
We do our best to show each piece accurately, but colors can look slightly different from one screen to another.
Stock is limited. Putting an item in your bag does not reserve it; it is held for you once you start checkout, for about 30 minutes.

Orders and payment
Payment is taken in full when you order, through Stripe. We never see or store your card details.
Your order is confirmed when you receive a receipt by email. If we cannot fill an order, for example because of a stock or pricing error, we will cancel it and refund you in full.
We may limit quantities per order, and we may refuse or cancel an order we believe is fraudulent.

Shipping
We ship to addresses in the United States only.
Orders are packed and shipped within 3 to 5 business days of payment. During a new release it may take a little longer. You will receive an email when your order ships.
Delivery times after that are the carrier's estimates and are not guaranteed.
Please check your shipping address carefully. We are not responsible for orders sent to an address that was entered incorrectly. If a package is returned to us because of a wrong address, we will contact you, and you will need to pay for shipping it again.

Returns
All sales are final, except where an item arrives damaged, faulty or wrong. The details are in our Returns & Exchanges policy, which is part of these terms.

Our responsibility to you
If something we sold you is faulty or not what you ordered, we will replace it, give you store credit, or refund it, as set out in our Returns & Exchanges policy. Beyond that, and as far as the law allows, our liability for any order is limited to the amount you paid for it.

Our name and designs
The Billionaire Garments name, logo, designs and photographs belong to us and may not be copied or used without our written permission.

Changes to these terms
We may update these terms from time to time. The version on this page when you place your order is the one that applies to it.

Governing law
These terms are governed by the laws of the United States and of the state in which Billionaire Garments is registered.`,
  privacy: `This policy explains what information Billionaire Garments collects when you use this website and what we do with it.

What we collect
When you place an order we receive your name, email address, phone number, shipping address and what you bought. Payments are handled by Stripe. Your card details go directly to Stripe and are never seen or stored by us.
If you join our list, we keep the email address you give us.
We count visits to the site to understand how the shop is doing. This uses no cookies and does not store your IP address, so it cannot identify you. Separately, to stop abuse, the site keeps the internet address behind each checkout and mailing-list sign-up for up to 24 hours and then deletes it.

How we use it
We use order details to deliver your order and to contact you about it. We use list sign-ups to send news about drops and offers. You can ask to be removed at any time.

Who we share it with
We share order details only with the companies that help us run the shop: Stripe for payments, our website host, our email provider, and the carrier that delivers your order. We do not sell your information.

Your choices
To see, correct or delete the information we hold about you, or to leave the list, email us at the address at the bottom of this site.`,
};
