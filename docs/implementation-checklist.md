# Implementation checklist

State of the application as of 2026-10-01, on top of commit `0c7f776`. This file separates what the code does from what has been checked against real providers and real devices.

"Tested" below means automated tests that run the real route handlers against an isolated in-process PostgreSQL (PGlite) with in-memory stand-ins for Stripe, Google Routes, object storage, Expo push and the Clerk admin API. Those stand-ins prove the application's own logic. They are **not** verification of Google, Stripe, S3-compatible storage, Expo push, real Clerk sessions, GPS or device behaviour.

## Complete (implemented and covered by automated tests)

| Area | What works |
| --- | --- |
| Accounts | Server-verified Clerk sessions, user sync, account switching clears per-user state on the device |
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
| PostgreSQL | Concurrency tests run on PGlite with one connection locally; real row-lock contention needs the CI job on PostgreSQL 16 | `TEST_DATABASE_URL` run described in the README |

## Missing

Nothing in the authorised scope is known to be missing. The following are deliberately small in this release and listed so they are not mistaken for finished products:

- Support has no file attachments and no driver-initiated support request (drivers use safety reports).
- The operator console is English only.
- The inbox has no quiet hours.
- Deletion of a driver's stored documents runs through the existing deletion worker; there is no operator screen to watch one specific account's deletion beyond the System page counters.

## Blocked

| Item | Blocker |
| --- | --- |
| Verification against real providers | Needs the owner's Clerk, Stripe test-mode, Google Cloud and storage credentials, and physical devices |
| Applying migrations 013–017 to the shared database | Not authorised in this work; run `npm run db:migrate` against the target database when ready |
| Retention periods for retained records | A policy and legal decision; the code keeps the records and documents what is kept, without inventing a period |

## Features requiring a separate decision

These are not implemented and must not be added without an explicit decision. Each needs the listed dependencies first.

| Feature | Dependencies before it can be built |
| --- | --- |
| Live payouts or Stripe Connect onboarding | Legal entity, Connect account type, KYC flow, payout schedule, tax reporting, reconciliation design. The earnings ledger records amounts only and must keep saying nothing has been paid out |
| Commercial cancellation fees | Fee amounts and grace periods, disclosure wording, payment capture rules for partial amounts |
| Surge pricing | Pricing rules, caps, disclosure, regulator expectations |
| Changed commission rates | A commercial decision; the ledger already versions commission policies |
| A new payment currency | Stripe account capabilities, price formatting, fare policies per currency |
| Scheduled rides | Dispatch window, hold timing (card holds expire), cancellation rules |
| Multiple stops | Routing and pricing rules, driver flow |
| Pooled rides | Matching, pricing split, safety rules |
| Vehicle service classes | Classes, eligibility, per-class fare policies |
| Emergency dispatch | A contracted emergency-services integration; the app currently states that it does not contact emergency services |
| Phone-number masking or in-app calling | Telephony provider, cost, consent and recording rules |
| Automated identity verification or document authenticity claims | A verification provider and its legal basis; today a person reviews documents and nothing claims authenticity |
| Country-specific transport or insurance eligibility rules | Local legal advice per operating country |
