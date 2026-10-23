# Fynliq Earn AI — buyer-funded work roadmap

## Product principle

AI completing a deliverable does not generate income by itself. Money is earned only if an actual buyer has agreed to pay, the work is accepted when required, and payment evidence is verified. Do not display generated AI guesses as customer earnings.

The existing pilot can generate short commercial captions, product listings and client replies from a customer's supplied, non-sensitive brief. These drafts are labelled "NOT sent or paid." No customer revenue, payment, order or delivery is claimed.

## Paid task workflow (next product phases)

1. Buyer posts a funded task with price, scope, deadline, AI-use permission and acceptance criteria.
2. Customer chooses to accept it, seeing transparent fees, terms and ownership conditions.
3. AI executes a narrow permitted tool using the approved brief and generates a reviewable deliverable.
4. Customer reviews and approves. Reject deceptive claims, impersonation, plagiarized assets and unauthorized access.
5. Submit via a platform-approved integration and preserve proof of submission.
6. Verify buyer acceptance and resolve quality issues or disputes.
7. Reconcile payment settlements from a trusted provider such as Stripe Connect, with signed verified events and exact order IDs. Never allow the AI or the SMS customer to mark a job as paid.
8. Authorize customer payouts after onboarding/KYC and applicable tax or withholding review. Keep payout controls separate from model output.

Possible statuses: buyer_funded, customer_approved, ai_drafted, draft_approved, submitted, buyer_accepted, payment_settled, payout_completed, rejected, disputed, refunded, canceled.

Customers must not be shown "earned" amounts based on task estimates, generated descriptions, or submissions. Payouts must be backed by actual confirmed funds.

## SMS commands already implemented

- UBER / RIDE / BOOK AN UBER: official https://m.uber.com/ ride handoff, where the rider checks the price and confirms. No ride is booked through Fynliq yet.
- DEALS: searches only a configured, manually reviewed and recently checked offer catalog. Without a catalog, says none available.
- DEALS JOIN then DEALS YES: stores separate explicit promotional preference. DEALS STOP removes it. STOP removes all messaging authorization.
- TASK CAPTION: [brief] generates an ad caption draft, not submitted.
- TASK LISTING: [brief] generates a product description draft, not published.
- TASK REPLY: [brief] generates a professional client-reply draft, not sent.

Automatic deal-message broadcasting, Uber API booking, task marketplaces, payments and autonomous task submission are NOT implemented in the pilot.

## Curated deal catalog

Server-only setting: FYNLIQ_REVIEWED_DEALS_JSON (JSON array).

Each item must contain:
- title: human-readable description (5–90 characters)
- sourceUrl: public HTTPS terms URL
- reviewedAt: ISO 8601 timestamp no older than 72 hours
- expiresAt: future ISO 8601 timestamp
- reviewedByFynliq: true only after actual operator verification

Only one item is shown per on-demand text. Source links and operator flags do not prove a deal on their own; independently verify price, eligibility, terms and expiry. Do not publish fabricated or unapproved offers.

## Messaging compliance and safeguards

Promotions require explicit additional campaign consent beyond customer-service SMS. The pilot saves consent state, but not a full disclosure audit history; implement disclosure version, timestamp, messaging campaign identity and consent evidence before live promotional alerts.

For outgoing messages, add an approved sender and campaign, reliable queued idempotent dispatch, suppression at send time, quiet hours and frequency caps, spend limits, delivery status tracking, STOP/HELP flows and incident monitoring. No Twilio number has been purchased or configured.

Uber ride deep links do not include fare estimates or make purchases. A fuller API booking requires appropriate Uber access, customer OAuth approval and explicit action confirmation.

Do not handle customer bank details, card numbers, passwords, or client credentials through SMS. The existing model supports drafts; the separately trained Fynliq model has not been verified as a callable endpoint.

## Milestones

Phase A (in draft PR): SMS action router, customer consent and deal preferences, reviewed offers on-demand, Uber deep link, scoped AI draft tasks and automated tests.
Phase B: Verified client orders and payouts (Stripe Connect or approved alternative); customer approvals and authenticated dashboard.
Phase C: Human-approved submission adapters, buyer acceptance, payout reconciliation and dispute controls.
Phase D: Proactive deal alerts and (if approved) OAuth-based Uber bookings with customer confirmation.

No live buyer orders, earnings, Uber bookings or promotional broadcasts are claimed as part of the current implementation.
