# Fynliq Crisis Cash — SMS product suite

## Goal
Help a person facing job loss, a pay cut or an unexpected bill take practical, authorized steps to improve their cash position. Fynliq never promises that cash will arrive without a funding source and completed verification.

### Product 1 — Relief Navigator
Customer texts: CRISIS, AID, FOOD, RENT or UTILITIES.

What is implemented:
- Direct customers to official benefits information: https://www.usa.gov/benefits
- Direct local assistance inquiries to United Way 211 at https://www.211.org/ (or dial 211).
- Disclose clearly that benefit qualification, application, and funding have **not** been checked.

What is not implemented:
- Live program lookup by ZIP code, prequalification, application submission, benefits approval or disbursement.

Further build:
- Approved, fresh assistance directories with geo-specific providers, eligibility rules and provenance.
- A secure **web portal**, not SMS, for income/household documents when explicitly authorized.
- Assistance applications only via official or authorized partner workflows, with customer review and approval.

### Product 2 — Work Navigator
Customer texts: WORK or JOBS.

What is implemented:
- Links to the U.S. Department of Labor-sponsored CareerOneStop resources for real job searching.
- Offers Fynliq TASK CAPTION, TASK LISTING and TASK REPLY as **draft work** tools.

What is not implemented:
- Employer verification, live openings, automated applications, paying clients, contracts, or income.

Further build:
- Actual opt-in buyer marketplace: funded tasks, approved buyer orders, scoped AI execution, customer QA, authorized delivery, verified settlement. Review the buyer's terms on AI use; do not misrepresent who completed the work.

### Product 3 — Bill Relief Coach
Customer texts: BILL RENT, BILL UTILITY, BILL CARD, BILL PHONE or BILL MEDICAL.

What is implemented:
- A ready-to-copy hardship negotiation request asking the real provider about payment plans, waivers and terms in writing.

What is not implemented:
- Calling the merchant, negotiating, changing contract terms, waiving debt or accessing an account.

Further build:
- With a distinct authenticated login and explicit action approval, let the customer submit an accurate request to supported billers, retain a receipt and monitor the provider's response.
- Never make false claims of hardship or bind the customer to a revised contract without review.
- Financial counseling and creditor communications may implicate licensing / consumer-protection rules: legal review before commercialization.

### Product 4 — Cash-Flow Gap Calculator
Customer texts: BUDGET [monthly take-home income] [essential bills] [other spending].

Example: BUDGET 1600 1200 250 -> **$150.00** self-reported monthly remainder.

What is implemented:
- Exact decimal-to-cents arithmetic, self-reported surplus/deficit, no account data access or storage.
- When negative, suggests assistance and hardship steps.

What is not implemented:
- Linked bank balances, transaction categorization, personalized licensed advice, debt rearrangement or investment recommendations.

Further build:
- Optional customer-authorized transaction connections in a secure app, not SMS. Show separate spending, savings, income and available funds; verify all categorization and clearly label estimates.

### Product 5 — Real-Earnings and Payout Ledger (future)
Customer texts: PAYOUT, MY EARNINGS or BALANCE.

What is implemented:
- Honest statement that no paid Fynliq task ledger, customer funds, payout verification or bank-transfer connection exists.

What is not implemented:
- Deposits, cash advances, instant payouts, wallet balances, bank transfers or unclaimed-money claims.

Future architecture:
1. A **real external buyer or authorized funding organization** funds work/aid using a permitted, documented workflow.
2. Customer signs up through **secure authenticated web onboarding**; payment provider handles KYC, tax forms and payout instruments. Never ask for bank/card credentials over SMS.
3. Customer authorizes work, including constraints and platform terms. AI performs only permitted tasks and prepares auditable deliverables.
4. Buyer accepts the work, or approved funding agency authorizes payment.
5. Verified provider webhooks and settlement reconciliation determine the actual amount earned, fees, reversals and available balance.
6. Only the payment service initiates permitted transfers to an authenticated, eligible customer's linked bank account. User sees provider-confirmed success or failure.
7. No statements that the money is paid until supported by verified settlement / payout events; refunds, disputes and withholding handled explicitly.

Consider Stripe Connect for paid work marketplace payouts. The existing Fynliq Stripe account is **not** a Connect payout integration for these customers. Do not create payments or transfers as part of this prototype. Marketplaces and money movement need a legal and compliance review, including anti-fraud, consumer-protection, KYC, AML, 1099 reporting, supported regions and fund-flow responsibilities.

### Product 6 — Scam Safety
Customer texts: SCAM.

Warns about upfront payment to receive a job, sharing one-time codes, and credential exposure.

## TikTok data boundary

The owner connected TikTok @thegrantgenius via Metricool to ChatGPT. Analytics returned zero-only values as of the last check, so no usable performance data has been incorporated. No personal TikTok content, account credentials, DMs or private insights are placed in this customer-facing code.

If creator analytics later become readable:
- Do not silently use owner account insights as customer data or imply TikTok has approved platform-wide resale/reuse.
- Request separately scoped rights for each customer's connected creator account. Honor platform access terms, opt-in, revocation, retention periods and data deletion.
- Creator payout claims must come from independently verified advertiser/platform settlements, not estimated views.

## SMS privacy, compliance and rollout

Existing Fynliq messaging is a draft pilot; no Twilio number has been purchased and the Supabase consent migration has not been applied.

- Required: messaging registration, explicit opt-in, STOP/HELP, privacy notice, rate limits, service-role secrets, message-SID deduplication and an asynchronous queue.
- SMS is not secure for SSNs, bank credentials, passwords, medical documentation or tax records. The prototype accepts only non-sensitive instructions and numerical totals.
- It does not collect financial credentials, submit forms, contact creditors, execute purchases, send marketing broadcasts, or move money.
- Do not merge into production or onboard real customers without testing, threat modeling, live help-directory validation and appropriate legal review.

## Manual tests

Run: node --test test/sms-earn.test.mjs test/sms-actions.test.mjs test/crisis-products.test.mjs

Expected:
- CRISIS -> product list
- AID / FOOD / RENT / UTILITIES -> official navigation, no approvals claimed
- WORK -> job resource plus Fynliq draft tool
- BILL CARD -> copyable request, not transmitted
- BUDGET 1500.25 1200.50 350.05 -> $50.30 gap
- PAYOUT -> no verified funds or transfer
- Any command prior to JOIN -> YES -> not processed as a consented AI service
