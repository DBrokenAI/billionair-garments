# Putting Billionaire Garments online

This guide takes the site from "files in a folder" to a live shop on the owner's domain that takes real payments. It is done once and takes about an hour.

When it is finished, everything runs in accounts the **owner** owns: their Cloudflare account hosts the site, their Stripe account takes the money and pays their bank, and their GitHub account holds the code.

## Where things stand

Steps 1, 2, 3 and 6 are **already done**: the domain is on Cloudflare, the database exists (its id and the Cloudflare account id are in `wrangler.jsonc`), the tables are built, and the site is deployed at a temporary `.workers.dev` address. What is left is step 4 (first password), step 5 and the second half of step 6 (Stripe), step 7 (domain), step 8 (test and go live) and step 9 (emails). The finished steps stay here as a record, and for anyone who ever has to set the site up again from nothing.

## Who does what

The steps below use a terminal. **The owner does not need to do those.** The usual way is for a developer to do the setup as an invited helper inside the owner's accounts, with the owner present for the few parts that need them:

| The owner does (no terminal) | The developer does |
|---|---|
| Creates the Cloudflare account and invites the developer: **Manage Account → Members → Invite**, role **Administrator** | Steps 2, 3, 4, 6 and the commands in 5 and 8, from their own computer. `npx wrangler login` signs in as the developer and offers the owner's account |
| Creates the Stripe account and completes business verification for the LLC (step 5) | Guides the nameserver change (step 1) and the custom domain (step 7) on a call or in person |
| Logs in to the domain registrar for the nameserver change (step 1) | Sets a **temporary** dashboard password (step 4) and tells the owner what it is |
| Pastes the Stripe keys into Cloudflare's website himself, so the developer never holds the live key: **Workers & Pages → billionaire-garments → Settings → Variables and Secrets → Add**, type **Secret**, names `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` | Runs the test purchase with the owner (step 8) |
| Creates a Resend account for emails and pastes its key into Cloudflare the same way (step 9, optional) | Adds Resend's DNS records in Cloudflare (step 9) |
| Signs in at `/admin` with the temporary password and chooses his own under **Settings → Your password** | Shows him the dashboard: Orders, Products, Settings |
| Removes the developer when done: **Manage Account → Members → Remove** | |

After that the developer has no access and does not know the dashboard password.

If you are the owner and comfortable with a terminal, you can do every step yourself.

**What it costs:** Cloudflare's free plan covers this site on ordinary days. Stripe charges per sale (about 2.9% + 30¢ on US cards) and nothing monthly.

**Before a big drop, move to Cloudflare's paid Workers plan ($5 a month).** The free plan stops answering after about 100,000 requests in a day (roughly 50,000 shop visits) and the shop, including checkout, is down until midnight UTC. Visitors see "Error 1027". To upgrade: Cloudflare → Workers & Pages → Plans → Workers Paid.

## What you need before you start

- The login for wherever you bought your domain (GoDaddy, Namecheap, Squarespace, etc.)
- Your LLC details for Stripe: legal business name, EIN, business address, and the business bank account for payouts
- A computer with [Node.js](https://nodejs.org) installed (pick the "LTS" download)
- This project folder on that computer

Every command below is typed into a terminal opened **inside the project folder**. On Windows: open the folder, right-click an empty area, choose "Open in Terminal".

---

## Step 1. Create your Cloudflare account and add your domain

1. Go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) and create an account with your business email. Turn on two-step login (My Profile → Authentication).
2. Click **Add a domain**, type your domain, and choose the **Free** plan.
3. Cloudflare shows the DNS records it found. **If you have email on this domain (like info@yourdomain), check that the "MX" records are in the list before continuing.** If they are missing, your email stops working when you switch. Add them from your current provider's settings first.
   - **Delete the records that point at the old website**: the `A`, `AAAA` and `CNAME` rows for the bare domain and `www` (for an old Shopify store, also `account`). Cloudflare refuses to attach the domain to the new site in step 7 while they exist. Leave every `MX` and `TXT` row alone: those are email.
4. Cloudflare gives you two **nameservers**. Log in where you bought the domain, find "Nameservers", choose "custom", and replace what is there with Cloudflare's two. (A domain bought through Shopify is changed in Shopify: Settings → Domains → the domain → Domain settings.) If the registrar has **DNSSEC** switched on, switch it off first.
5. Wait for Cloudflare's email saying the domain is active. Usually under an hour, sometimes up to a day. You can keep going with steps 2 to 6 while you wait.

## Step 2. Connect this folder to your Cloudflare account

```sh
npm install
npx wrangler login
```

A browser window opens. Click **Allow**.

## Step 3. Create the database

The database holds your stock, orders, mailing list and visitor counts.

```sh
npx wrangler d1 create billionaire-garments
```

**Already done for this shop: skip to step 4.** Only when setting the site up again in a different Cloudflare account: first change `account_id` in `wrangler.jsonc` to that account's id (shown by `npx wrangler whoami`), or every command is refused. Then run the command above. If it offers to add the database to the configuration file for you, answer **No**. It prints a `database_id` (a long code with dashes). Open `wrangler.jsonc`, find the `database_id` line, and replace the code there with the new one. Save. Then build the tables:

```sh
npm run db:remote
```

Type `y` when asked. This also adds the starting sets with **stock at 0**, so everything shows "Sold out" until the real numbers are entered under Products in the dashboard. Running this command again later is safe: it never brings back a set that was deleted.

## Step 4. Set the first dashboard password

```sh
npx wrangler secret put ADMIN_PASSWORD
```

It asks you to type the password (nothing shows as you type, which is normal). This is the **temporary** password for the first sign-in. Once the site is online, the owner signs in at `/admin`, scrolls to **Your password**, and chooses their own. From then on only theirs works, and it is stored scrambled so nobody can read it. Make the final one long and don't reuse one from elsewhere: it is the only thing protecting the dashboard.

If it asks whether to create a new Worker named `billionaire-garments`, answer `y`.

## Step 5. Set up Stripe and add your key

1. Create your account at [dashboard.stripe.com/register](https://dashboard.stripe.com/register) and complete **business verification** as your LLC (EIN, address, bank account). Stripe will not pay out until this is done.
2. Start in **test mode** so you can try a purchase without real money. In Stripe, switch to test mode (or a "Sandbox"), then go to **Developers → API keys** and copy the **Secret key**. It starts with `sk_test_`.
3. Give it to Cloudflare:

```sh
npx wrangler secret put STRIPE_SECRET_KEY
```

Paste the key when asked.

> **Treat the secret key like the PIN to your bank account.** Anyone who has it can issue refunds and see your customers. It only ever goes into that command. Never put it in a file in this folder, an email, or a text. If it ever leaks, go to Developers → API keys in Stripe and "roll" it, then run the command above again with the new one.

## Step 6. Put the site online

```sh
npm run deploy
```

It prints an address ending in `.workers.dev`. Open it: your shop is live at that temporary address.

Now tell Stripe where to report payments:

1. In Stripe (still in test mode): **Developers → Webhooks → Add destination** (or "Add endpoint").
2. Endpoint URL: `https://YOUR-DOMAIN/api/stripe/webhook` (use your real domain, e.g. `https://billionairegarments.com/api/stripe/webhook`).
3. Select these four events:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
4. Save, then reveal the **Signing secret** (starts with `whsec_`) and give it to Cloudflare:

```sh
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

## Step 7. Point your domain at the site

Do this once Cloudflare says your domain is active (step 1).

1. In Cloudflare: **Workers & Pages → billionaire-garments → Settings → Domains & Routes → Add → Custom domain**.
2. Enter your domain (e.g. `billionairegarments.com`) and save. Repeat for `www.yourdomain.com` if you want both to work.

Within a few minutes the shop is at your domain, with the padlock (HTTPS) set up automatically.

## Step 8. Test a purchase, then go live

**Test first.** In the dashboard, under Products, give one set a stock of 1 so there is something to buy. On your site, add a set to the bag and check out. On Stripe's payment page use card number `4242 4242 4242 4242`, any future expiry date, any 3-digit code, any ZIP. You should land on the thank-you page. Then open `https://YOUR-DOMAIN/admin`, sign in, and confirm the order is there and the stock went down by one.

**Then get the shop ready, before any real money:**

1. Under Orders, press **Cancelled / refunded** on the test order so it doesn't count as a sale. (Either answer to the stock question is fine: the real numbers go in next.)
2. Under Products: check every set's name, price and photos, delete any set that isn't really for sale, and enter the real stock numbers. Do this **after** item 1, so the numbers you type are the final ones.
3. Under Settings: check the shipping price, the top-bar messages and the contact email, and write the returns policy.
4. Wait 45 minutes after the last test checkout, so none is left half-finished when the keys change.

**Then switch to real money:**

1. In Stripe, switch to **live mode** and copy the live Secret key (`sk_live_...`). The owner pastes it into Cloudflare's website himself, so nobody else ever holds it: **Workers & Pages → billionaire-garments → Settings → Variables and Secrets**, edit `STRIPE_SECRET_KEY`, paste, **Deploy**. (The command `npx wrangler secret put STRIPE_SECRET_KEY` does the same thing.)
2. Add the webhook again in live mode (same URL, same four events). Live mode has its own signing secret: put it in `STRIPE_WEBHOOK_SECRET` the same way.
3. In Stripe: **Settings → Business → Customer emails**, turn on **Successful payments** so buyers get a receipt.
4. Buy the cheapest set with a real card. In Stripe → Developers → Webhooks, check the delivery shows a green "200". If emails are set up (step 9), check the "new order" email arrived, press **Mark shipped** and check the customer email too. Then refund it in Stripe and press **Cancelled / refunded** on it in the dashboard, answering **OK** to put the item back in stock. (Stripe keeps its small fee on a refunded payment.)
5. Once the shop is on its own domain, switch off the temporary `.workers.dev` address so there is only one front door. In `wrangler.jsonc`, add the lines `"workers_dev": false,` and `"preview_urls": false,` under `"main"`, then run `npm run deploy`. (Switching it off only in Cloudflare's website is undone by the next deploy.)

The yellow "TEST mode" banner in your dashboard disappears once the live key is in.

## Step 9. Turn on emails (optional, 15 minutes)

With this done, the site emails the customer when an order is marked shipped (with the tracking number), and emails the owner when an order is paid. Without it the shop works the same, with no emails from the site itself (Stripe still sends receipts). The dashboard shows a banner while emails are off.

Emails are sent through [Resend](https://resend.com), which is free for up to 3,000 emails a month at the time of writing.

1. The owner creates a Resend account at resend.com.
2. In Resend: **Domains → Add Domain**, enter the shop's domain. Resend lists a few DNS records. Add them in Cloudflare (**the domain → DNS → Records**), or use Resend's "Sign in to Cloudflare" button to add them automatically. Wait for Resend to show the domain as **Verified**.
3. In Resend: **API Keys → Create API Key**, permission **Sending access**. Copy the key (starts with `re_`).
4. In Cloudflare: **Workers & Pages → billionaire-garments → Settings → Variables and Secrets → Add**, type **Secret**, name `RESEND_API_KEY`, paste the key. (Or `npx wrangler secret put RESEND_API_KEY`.)
5. Check **Dashboard → Settings → Contact and emails**: the contact email there is where order alerts go and where customer replies land. It must be a real inbox.

Emails come from `orders@` the shop's domain. Both emails are tried out during the real-card test at the end of step 8; the dashboard says whether each email went out.

---

## Running the shop day to day

Everything routine happens at **`https://YOUR-DOMAIN/admin`**. Bookmark it on your phone.

| You want to... | Where |
|---|---|
| See visitors, sales, and where shoppers drop off | Dashboard, top half |
| See new orders and addresses to ship to | Dashboard → Orders. Press **Mark shipped** when it's in the mail; the customer is emailed |
| Add a set, or change a name, price, photo or stock count | Dashboard → Products. Change it, press **Save** on that set |
| Take a set off the shop without deleting it | Dashboard → Products. Untick **Show in the shop**, press **Save** |
| Change shipping prices, the top-bar messages, or the policy pages | Dashboard → Settings |
| Download your email and text list | Dashboard → Settings → Mailing list |
| Change your dashboard password | Dashboard → Settings → Your password |
| Refund an order, see payouts to your bank | [dashboard.stripe.com](https://dashboard.stripe.com) |

Stock goes down by itself when someone pays. If you refund an order in Stripe, then press **Cancelled / refunded** on that order under Orders: it leaves your to-ship list and sales figures, and asks whether to put the items back in stock. That button does not move any money; the refund itself is always done in Stripe.

Stripe can also notify you of each sale: in Stripe, **Profile → Communication preferences → Successful payments**, or install the Stripe phone app.

Nothing in day-to-day running needs a developer or a code change. Products, prices, photos, stock, shipping prices, the top-bar messages, the policy pages and the password are all edited in the dashboard.

## Things to decide (not set up for you)

- **Sales tax.** The site does not collect sales tax until you turn it on. Ask your accountant where your LLC must collect. When ready: set up **Stripe Tax** in Stripe (Settings → Tax), then tick **Add sales tax at checkout** in Dashboard → Settings. If Stripe refuses, checkout carries on without tax and the dashboard shows a warning.
- **Returns policy.** The privacy policy comes pre-written to match what the site does; read it once. The returns policy is blank and hidden until you write it in Dashboard → Settings. Stripe may ask for one.
- **Shipping outside the US.** Checkout only accepts US addresses. Changing that needs a developer.
- **Text message marketing.** The sign-up form collects phone numbers, but US law (TCPA) has specific consent rules for marketing texts. Use a proper texting service and check its consent requirements before messaging the list.

## If something goes wrong

- **"Checkout isn't switched on yet"**: the Stripe key is missing. Redo step 5, part 3.
- **Paid orders don't show in the dashboard**: check the webhook (step 6). In Stripe → Developers → Webhooks, open your endpoint and look for failed deliveries. Orders also settle themselves within about 40 minutes even if the webhook is broken.
- **"No email was sent" after marking an order shipped**: the message says why. Usually step 9 isn't done, the domain isn't verified in Resend yet, or the order has no email address.
- **A photo won't upload**: use a JPG or PNG. iPhone "HEIC" photos may need to be sent to yourself as JPG first, or uploaded from the phone itself.
- **Want a new dashboard password**: sign in at `/admin` and use **Settings → Your password**.
- **Forgot the dashboard password**: in Cloudflare go to **Storage & Databases → D1 → billionaire-garments → Console**, paste `DELETE FROM settings WHERE key = 'owner_password';` and run it. The temporary password from step 4 works again (reset that too if needed: **Workers & Pages → billionaire-garments → Settings → Variables and Secrets → ADMIN_PASSWORD**). Sign in and choose a new one.
- **Locked out after too many tries**: wait 15 minutes.
- **See what the server is doing**: Cloudflare → Workers & Pages → billionaire-garments → Logs.

## For a developer picking this up

No framework and no build step. `public/` is static files, `src/worker.js` is the whole backend (a Cloudflare Worker with a D1 database), `schema.sql` is the database. To run it locally: copy `.dev.vars.example` to `.dev.vars` with **test** keys, then `npm run db:local` and `npm run dev`. See `README.md` for how the pieces fit.
