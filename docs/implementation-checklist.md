# Implementation checklist

State of the application as of 2026-10-02. This file separates what the code does from what has been checked against real providers and real devices.

"Tested" below means automated tests that run the real route handlers against an isolated in-process PostgreSQL (PGlite) with in-memory stand-ins for Stripe, Google Routes, object storage, Expo push and the Clerk admin API. Those stand-ins prove the application's own logic. They are **not** verification of Google, Stripe, S3-compatible storage, Expo push, real Clerk sessions, GPS or device behaviour.

## Complete (implemented and covered by automated tests)

| Area | What works |
| --- | --- |
| Accounts | Server-verified Clerk sessions, user sync, account switching clears per-user state on the device; an expired session signs the app out with a notice; provider error text is replaced by the app's own messages in both languages |
| Profile | Edit display name; language preference (English, Albanian) stored on the server and the device |
| Saved places | Home, Work and up to 20 custom places; ownership, validation, limits, duplicate-submission protection; usable as pickup or destination |
| Booking | Service-area check, road-based quote, fixed fare, card hold, quote expiry handled explicitly, one active ride per passenger |
| Ride lifecycle | State machine, matching, re-matching, cancellation rules, interruption, sweep recovery |
| Payments | Manual-capture PaymentIntents, capture on completion, release on cancellation, webhook handling, retry and review flags |
| Receipts | Derived from server and Stripe records; outcome and payment state are codes the app translates |
| Ride history | Paginated history (`GET /api/rides/history`) with keyset cursors |
| Driver | Application, document workflow, availability, offers, live location, trip progression, earnings ledger (recorded, never described as paid out) |
| Chat and ratings | Per-ride chat with retention, ratings with edit window and moderation |
| Safety | Reports, message reports, trip share links, operator triage |
| Notification inbox | In-app inbox with read state, categories, pagination and deduplication; preferences switch push alerts per category and never remove an item from the inbox |
| Support | Passenger-visible status and a scoped conversation per request; operator assignment, replies, internal notes, resolution, reopening |
| Account deletion | Recent re-authentication required, blockers, anonymisation in one transaction, retryable identity and payment-customer deletion |
| Operations | Rate limits on abuse-prone writes, health and readiness endpoints, configuration checklist, sweep lease so concurrent sweeps do not overlap, job status, queue counters |
| Operator console | Web only; review, support, rides, feedback, safety, drivers, service areas, system status; queue badges |
| Localization | English and Albanian for every passenger and driver screen, with identical key sets checked by a test |
| Support for drivers | Requests record the requester's role and optional ride; drivers open them from the driver screen, a trip or the safety screen; operators filter by role |
| Support attachments | Private JPEG and PNG attachments with a ticket, direct upload, server-side checks and promotion, short-lived view links, audit, limits and retention; a clear "not available" state without storage |
| Trip PIN | Per-assignment PIN shown only to the passenger, verified in the start transaction, attempt limits with lock and block, rotation on re-match, audited operator waiver, rides without a PIN unaffected |
| Quiet hours | Server-stored range with a time zone, overnight ranges, daylight-saving handling, optional pushes skipped and never sent later, critical pushes always sent, inbox unaffected |
| Vehicle categories | Operator-managed categories with history; fare policies per area and category; drivers linked through verification; passenger chooses category and passenger count; capacity and category matching; snapshots; deactivation rules; existing drivers and policies migrated to a default category |
| Stops | Up to two stops, validated and routed in order, one fare, snapshot on the ride, ordered progress, completion blocked while a stop remains, hidden from the public share page |
| Scheduled requests | Saved request with the area's time zone, sweep-driven confirmation window, fresh quote and authorization only on confirmation, expiry without a charge, cancellation, upcoming and past lists |
| Payment in the vehicle | Requests without a card; lek fares rounded to a whole lek; the driver records terminal, cash or unpaid; unpaid trips flagged and the passenger blocked until support settles or waives; earnings written on collection; driver balance; operator-recorded transfers with idempotency and audit; card mode kept behind a setting |
| Operations dashboard | Live and period counts with stated definitions, UTC, range limit, permissions, cache with freshness, per-section unavailable state, drill-down links, no personal data |

## Implemented, awaiting external verification

| Area | What has not been verified | How to verify |
| --- | --- | --- |
| Clerk | Real sign-up, sign-in, password reset, email change, password re-verification before deletion, identity deletion through the Clerk API | Manual checklist, sections 1 and 10 |
| Stripe | Real test-mode PaymentSheet, 3-D Secure, capture, release, refunds, disputes, webhooks, customer deletion | Manual checklist, sections 3 and 7 |
| Google Routes | Real quotes, route matrix ranking, quota behaviour | Manual checklist, section 5 |
| Google Places | Address search in both languages | Manual checklist, section 2 |
| Object storage | Presigned POST or PUT against a real private bucket, ETag preconditions, deletion | Manual checklist, section 6 |
| Expo push | Delivery, receipts, token invalidation, tap routing on a development build | Manual checklist, section 8 |
| GPS | Foreground and background tracking, stale position handling, force-quit | Manual checklist, section 9 |
| Accessibility | Screen-reader order and labels, text scaling, contrast on real devices | Manual checklist, section 11 |
| Albanian wording | Written during implementation; not reviewed by a native-speaking translator | Native-speaker review |
| PostgreSQL | The server suite passed twice on a disposable local PostgreSQL 18.4 instance with four connections (471 tests), so concurrency tests contended on real row locks. Not yet run on the PostgreSQL 16 CI job or against the production database | `TEST_DATABASE_URL` run described in the README; the CI `postgres` job |
| Support attachments | Upload, confirmation and view links against a real private bucket; progress and retry on a real connection | Manual checklist, section 14 |
| Trip PIN | Two-device behaviour, lock countdown, waiver notification | Manual checklist, section 13 |
| Quiet hours | Real push suppression and delivery on devices, across a real clock change | Manual checklist, section 8 |
| Vehicle categories and stops | Real routes through stops (Google Routes with intermediates), navigation hand-off, two-device matching by category and seats | Manual checklist, sections 15 and 16 |
| Scheduled requests | A real scheduler calling the sweep every minute, real push, real authorization at confirmation | Manual checklist, section 17 |
| New screens | Screen-reader order, text scaling and keyboard behaviour on the support, booking, schedule and driver PIN screens | Manual checklist, sections 11 and 13–17 |
| Session expiry | The sign-out on a refused session and the Clerk error-code mapping against real Clerk responses | Manual checklist, section 1 |

## Missing

Nothing in the authorised scope is known to be missing. The following are deliberately small in this release and listed so they are not mistaken for finished products:

- Support attachments are images only (JPEG, PNG), with no malware scanning and no authenticity check.
- The operator console is English only.
- Quiet hours are one daily range per account.
- Vehicle categories carry no commercial definitions; the only category created automatically is the default one for vehicles approved earlier.
- Stops are limited to two, fixed at request time, with no waiting fees.
- Scheduled requests are not reservations and never authorize a card without the passenger confirming.
- The dashboard is UTC only, with no charts or export.
- Deletion of a driver's stored documents runs through the existing deletion worker; there is no operator screen to watch one specific account's deletion beyond the System page counters.

## Blocked

| Item | Blocker |
| --- | --- |
| Verification against real providers | Needs the owner's Clerk, Stripe test-mode, Google Cloud and storage credentials, and physical devices |
| Applying migrations 013–024 to the shared database | Not authorised in this work; run `npm run db:migrate` against the target database when ready, after reading the deployment notes in [operations.md](operations.md) |
| Driver payouts | No payout provider or operating country has been chosen. Nothing moves money to drivers and no payout records exist. See [payout-readiness.md](payout-readiness.md) |
| Commercial values | Fare rates per category, commission, cancellation fees, category names and capacities, the scheduling window and attachment retention periods are business or legal decisions. The code ships development placeholders or neutral defaults and labels them |
| Retention periods for retained records | A policy and legal decision; the code keeps the records and documents what is kept, without inventing a period |

## Features requiring a separate decision

These are not implemented and must not be added without an explicit decision. Each needs the listed dependencies first.

| Feature | Dependencies before it can be built |
| --- | --- |
| Live payouts or Stripe Connect onboarding | Legal entity, Connect account type, KYC flow, payout schedule, tax reporting, reconciliation design. The earnings ledger records amounts only and must keep saying nothing has been paid out. Details in [payout-readiness.md](payout-readiness.md) |
| Commercial cancellation fees | Fee amounts and grace periods, disclosure wording, payment capture rules for partial amounts |
| Surge pricing | Pricing rules, caps, disclosure, regulator expectations |
| Changed commission rates | A commercial decision; the ledger already versions commission policies |
| A new payment currency | Stripe account capabilities, price formatting, fare policies per currency |
| Guaranteed reservations with a driver assigned in advance | Driver commitment rules, compensation, cancellation fees, hold timing (card holds expire). Today's scheduled requests are deliberately not reservations |
| Editing stops during a trip, waiting fees, more than two stops | Pricing rules for changes, driver consent, re-authorization of the card |
| Pooled rides | Matching, pricing split, safety rules |
| Commercial vehicle classes and per-class commission | Class definitions, eligibility rules and prices; the category mechanism exists but carries no commercial values |
| Emergency dispatch | A contracted emergency-services integration; the app currently states that it does not contact emergency services |
| Phone-number masking or in-app calling | Telephony provider, cost, consent and recording rules |
| Automated identity verification or document authenticity claims | A verification provider and its legal basis; today a person reviews documents and nothing claims authenticity |
| Country-specific transport or insurance eligibility rules | Local legal advice per operating country |
