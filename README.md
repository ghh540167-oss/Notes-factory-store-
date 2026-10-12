# Notes Factory — E-commerce starter

A custom HTML/CSS/JavaScript storefront with a Node.js/Express backend and Razorpay Checkout integration for physical products.

## Current state
- Responsive storefront and one editable Casio scientific calculator product.
- Shopping cart quantity control and delivery-details form.
- Backend creates Razorpay orders using server-side product pricing.
- Payment signature is checked server-side; the payment is fetched from Razorpay and amount/currency/order/status are verified.
- Webhook signature verification and duplicate-event handling.
- SQLite order records.
- Online payments are **disabled by default**. This is intentional.

## Run locally
1. Install Node.js 20 or newer.
2. In this folder, run `npm install`.
3. Copy `.env.example` to `.env`.
4. Keep `PAYMENTS_ENABLED=false` while previewing.
5. Run `npm start`, then open `http://localhost:3000`.

## Configure Razorpay (test mode first)
1. Create/verify a Razorpay merchant account and complete any required KYC/business verification.
2. Obtain **test-mode** API key ID and secret from the merchant dashboard. Put them in `.env`. Never expose the secret in frontend JavaScript or commit `.env`.
3. Set a strong random `ADMIN_TOKEN` (reserved for future admin endpoints; no admin dashboard is implemented yet).
4. Configure a Razorpay webhook pointing to `https://YOUR-DOMAIN/api/webhooks/razorpay`, subscribe to `payment.captured`, and set the same webhook secret in `RAZORPAY_WEBHOOK_SECRET`.
5. Configure shipping fees and make the final shipping amount visible and accepted before checkout. The current sample deliberately does not charge shipping because the real amount/business rule is unknown; therefore **do not enable live payments until shipping pricing is implemented**.
6. Replace the placeholder image and confirm exact calculator model, retail price, available stock, warranty and product wording.
7. Test successful, failed, cancelled, duplicate and delayed webhook payments using test mode.
8. Only then set `PAYMENTS_ENABLED=true` and use live keys when the merchant account is approved.

## Free-first deployment
This is a full-stack Node app, not a static-only site. Deploy it to a host that supports Node.js processes and persistent storage, or use a free static host for the frontend plus a separate backend host. Free tiers, sleep behavior, usage limits, payment-gateway eligibility and persistent-disk availability can change.
- The app uses SQLite (`DB_PATH` can point to a persistent disk). **Do not deploy to ephemeral storage for real orders**: data may be erased on restart/redeploy. Attach a persistent disk or switch to a managed PostgreSQL database before taking live orders.
- Use HTTPS in production.
- Set all environment variables in the host dashboard, not in source code.
- Set `BASE_URL` to the deployed HTTPS URL.
- Do not commit `.env`, API secrets, customer data or database files.

## Important launch gaps before accepting real money
- No admin dashboard, order fulfilment dashboard, stock decrement/reservation, shipment tracking, transactional email/SMS, or automated customer receipt is implemented yet.
- Shipping charge calculation and final payable amount are not implemented. Add them before live launch.
- The sample product price is ₹1,525 as a configurable placeholder. Verify your actual price before launch.
- The policies page is a draft placeholder and needs business-specific details.
- Add CAPTCHA/stronger abuse controls, logging/alerts, backups, privacy and retention controls, and production monitoring before scaling.
- Webhook currently records payment-captured events and updates orders; add reconciliation and refund handling for production.

## Files
- `server.js`: Express API, SQLite persistence, Razorpay order/payment verification and webhook.
- `public/index.html`: storefront and checkout UI.
- `public/styles.css`: responsive design.
- `public/app.js`: product rendering and checkout client.
- `public/policies.html`: policy placeholders.
