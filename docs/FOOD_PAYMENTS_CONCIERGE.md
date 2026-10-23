# Fynliq Food + Money SMS Concierge — integration phases

## User-facing pilot commands now implemented

Customer texts one of the following after JOIN → YES:

- `ORDER FOOD` or `FOOD DELIVERY`: lists supported food services; no order is placed.
- `DOORDASH`: verified official DoorDash landing page. Customer selects restaurant, checks fees, and checks out on DoorDash.
- `UBER EATS` / `UBEREATS`: official Uber Eats landing page; customer pays on Uber Eats.
- `GRUBHUB`: official Grubhub landing page; customer pays on Grubhub.
- `INSTACART` / `GROCERIES`: official Instacart shopping site.
- `GROCERY LIST: eggs, milk, rice`: bounded grocery list. If an approved Instacart developer API key is configured, send the list to their *shopping-list-link* API and return the official Instacart URL where the customer selects store, reviews, and pays. Otherwise return a normal Instacart shopping URL and state the API isn't connected.
- `MONEY`: navigation to BUDGET, AID, WORK, and PAYOUT, with explicit no transfer promises.
- `SEND MONEY`, `TRANSFER`, `PAY BILL`, `PAY NOW`, `CHECKOUT`, `CHARGE MY CARD`, `PLACE ORDER`, `CONFIRM ORDER`, `ORDER STATUS`: fail closed with explanation that no action occurred.

**Intentional distinction:** `FOOD` continues to mean food *assistance* (SNAP/WIC and 211 navigation), while `ORDER FOOD` means delivery shopping. During a crisis, Fynliq should make the low-cost/food-assistance path visible rather than assume customers can afford delivery fees.

## Connected API reality

- **DoorDash Marketplace**: Access is **limited to approved partners**. Published APIs mainly serve merchants, POS/integration providers, menus and receiving orders, not unrestricted consumer-cart ordering. Application/certification required. DoorDash Drive handles delivery logistics on a merchant's behalf, not consumer Marketplace checkout. References: https://developer.doordash.com/en-US/docs/marketplace/faq/getting_started/ and https://developer.doordash.com/en-US/docs/drive/overview/about_drive/.
- **Uber Eats**: Marketplace APIs require approval and primarily enable merchant/store menu synchronization, order reception and fulfillment after customer checkout. They do not give Fynliq unrestricted access to initiate consumer orders. Reference: https://developer.uber.com/docs/eats/guides/order-integration.
- **Instacart Developer Platform**: supports generating a shopping-list URL, not automatic consumer checkout. API endpoint `POST /idp/v1/products/products_link`; requires partner API key. The customer pays on Instacart. Reference: https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page/.
- **Grubhub**: In this pilot, only a handoff to the public consumer checkout website is supported.
- **Payments**: Existing Stripe connection for the Fynliq business is **not** permission to debit customers' third-party food accounts or move customer money. No Stripe charge, payment method, or transfer is created by this branch.

## Optional Instacart connector configuration

Server-only environment variables (never commit credentials or send them by SMS):
- `INSTACART_API_KEY`: approved Instacart Developer Platform bearer token.
- `INSTACART_API_ENV`: `development` for `connect.dev.instacart.tools`; `production` for `connect.instacart.com` (default).

Data sent to the partner: only the explicitly supplied list of up to eight product names, not any credit card details, user SMS history, or physical address. Authorization token is server-side. Validate returned URLs on HTTPS Instacart domains, fail closed on unexpected responses, and avoid logging raw data or credentials.

Prior to production: verify exact API partner terms and API payload contract in the partner's active environment, set call and spend rate limits, and account for idempotency/retries/quotas. Current deployment has no Instacart key; the adapter is **not live**.

## Secure automatic ordering — future architecture, requires approved APIs

1. Customer sends text requesting a purchase or booking.
2. Fynliq authenticates the user separately via a secure web portal and receives OAuth grants or approved provider-side account linking. SMS phone verification alone is insufficient to access a customer's stored payment method.
3. Partner API retrieves **real** availability, itemized quote, full delivery fees, taxes, tips, merchant, address and expiry. Fynliq never invents quotes.
4. Fynliq sends a concise quote plus secure signed confirmation page containing order details, merchant identity, amount, currency, address, delivery ETA, and terms. No raw card number or bank account number via SMS.
5. Customer explicitly authorizes this exact one-time transaction in a secure authenticated context. Use provider-approved payment rails; Fynliq must not charge its own Stripe account as a stand-in for a DoorDash/Uber Eats charge without a contractual commercial arrangement.
6. Server revalidates quote, idempotency key and user approval; executes a **single authorized order** through an approved provider API.
7. Only a verified provider order ID / status marks it confirmed. Send receipt/ETA. Never claim confirmed for a mere model response or a payment authorization alone.
8. Provide cancellation/refund/dispute support, delivery status updates, error handling, user controls, and audited logs.

Planned data model (not created in database): customer identity; verified OAuth token reference; provider type; itemized quote ID; expiration; total amount/currency; approval ID/timestamp; one-time idempotency key; provider order ID; payment status; fulfillment state; last verified provider event. Keep PII redacted/encrypted. Apply least-privilege RLS.

## Real money to customer accounts — separate product

The user's earning marketplace needs authentic funded tasks, approved delivery, provider-confirmed settlement, an authenticated Stripe Connect onboarding/payout flow and a proper ledger. Earnings and payouts are distinct from food purchases or ride payments.

Never let an LLM response, free-text SMS, or unverified client-provided status trigger a payout or debit. Never imply that buying via an external food service transfers money to the customer's bank account.

## Deployment / tests

This feature uses **existing** `/api/ask?channel=sms` (no additional Vercel serverless function). No Twilio phone number has been purchased, no live SMS sent, no new database migration applied, and no production deployment promoted.

Run:
`node --test test/sms-earn.test.mjs test/sms-actions.test.mjs test/crisis-products.test.mjs test/food-money-actions.test.mjs`

Before live SMS: apply the previously prepared consent migration, provision Twilio sender and approved campaigns, configure keys, implement idempotent queue + rate limiting, audit security and privacy, test SMS opt-out, and comply with platform agreements.
