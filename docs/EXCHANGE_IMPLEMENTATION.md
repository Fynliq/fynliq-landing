# Fynliq Exchange — Implementation plan (October 2026)

## What exists in this branch
- Public route `/exchange`, styled to fit a separate Fynliq sub-product.
- Browse four product categories with standardized variants.
- Real-time in-browser bid / ask order book; best bid and lowest ask.
- Deterministic price/time matching, strict variant matching and anti-self-trading.
- A browser-only Messages command demonstration: `PRICE SNEAKER`, `BUY SNEAKER 165`, `SELL HOODIE 50`.
- Automated matching unit tests.
- Staged SQL schema **not applied** to Supabase.

This is a prototype only. It **does not** provide persistence, real SMS, authentication,
inventory proof, fraud checks, checkout, shipping, card issuance or real customer transactions.
The demonstration deliberately does not store data.

## Launch stages
1. Create a dedicated non-production Supabase project; review/apply schema with RLS, private ownership policies, marketplace service functions and price-depth read API. Do NOT assume the currently connected Supabase project belongs to Exchange.
2. Implement authenticated seller onboarding, inventory proof, exact variant catalog, limited bid/ask lifespan, per-user rate limits.
3. Atomic placement and match reservation in one database transaction; concurrent bids must never fill one physical listing twice. Server-only writes and audit log; clients never determine sale state.
4. Connect Stripe Connect seller onboarding, hosted checkout, signed webhooks, permitted transfer/payout flow, dispute and refund handling. No unverified seller payouts. Do not advertise Stripe as escrow.
5. Add opted-in phone SMS only after verified ownership, consent logs, A2P 10DLC registration, rate limits, and STOP compliance. SMS initiates secure deep-link confirmations, not payment credentials.
6. Add shipping, seller reliability, chargeback defense, taxes, data retention/export/deletion, support and incident response.
7. Keep the website on Vercel and managed database services until home GPU infrastructure demonstrates production-grade uptime/security.

## Cloud data boundaries
- **Transactional data:** users, offers, orders, inventory, payouts, audit trails in managed Postgres.
- **Object data:** inventory proofs and documents in controlled encrypted object storage with retention rules.
- **Market aggregates:** derived price trends and supply/demand summaries; avoid raw personally identifiable info in merchant dashboards.
- **AI lab:** future NVIDIA machines run price recommendation inference and experiments; use de-identified or consented data, encrypted transfers, a secure VPN and access logging.
- **Card product:** later use bank/issuer program managers and a payment provider; keep PAN/CVV and regulated ledger with issuer/processor, not in Supabase tables or the bedroom cluster.

## Business considerations
Fynliq Exchange is an exchange for **physical goods**, not shares, tokenized assets, price betting, guaranteed investments, or a bank. Pricing by bid and ask is a marketplace mechanism. The product must disclose price, commissions, tax and shipping before confirmation.
