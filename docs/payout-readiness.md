# Driver payout readiness

Status: **manual transfers only**. The owner decided on 2026-10-04 that the business operates in Albania, takes payment in the vehicle (the business's card terminal, or cash) in Albanian lek, and pays drivers by bank transfer outside the app. The app records earnings, each driver's balance with the business, and the transfers an operator states were made. It moves no money, and an automatic payout integration remains blocked.

Decisions made:

| Decision | Outcome |

This document lists what has to be decided before payouts can be built, where a provider would connect to the existing code, and the accounting rules any implementation must keep.

## What exists today

- `mobility.ride_earnings` records one row per completed, captured ride: fare, commission rate and policy version, commission and driver share. A check constraint keeps `commission_cents + driver_share_cents = fare_cents`.
- `mobility.earning_entries` is the driver ledger. It is append-only, with one row per event: `ride_earning`, `tip`, `fare_refund_adjustment` and `tip_refund_adjustment`. Each row has a unique `source_key` so retries can't double-count, and a check keeps `gross = commission + driver amount`. Refunds after a ride appear as negative adjustment rows. Earlier rows are never edited.
- Drivers see their ledger totals on the Earnings screen. The screen says these are earnings recorded by the app, not payouts.
- Passenger money is collected on the platform's own Stripe account (PaymentIntents with manual capture, tips as separate PaymentIntents). There are no destination charges, `transfer_data` or `on_behalf_of`.

There is no payable balance, payout table, payout state machine or bank-account data, and none should be added before the decisions below are made.

## Decisions required (business, legal and finance)

None of these can be decided in code, and none were assumed. The first six block any payout code; the rest shape it.

| # | Decision | Why it blocks | Current state in the code |
| --- | --- | --- | --- |
| 1 | **Platform business country and legal entity** that collects fares and pays drivers | Decides which payout providers can be used, tax registration and reporting, and the law that applies to driver payments | None chosen. Passenger payments are collected on one Stripe test account |
| 2 | **Supported driver countries** (where a driver's bank account and tax residence may be) | Cross-border payouts need provider and bank support per country, and change identity and tax checks | None chosen. Driver applications record no country, bank or tax details |
| 3 | **Payout provider** (for example Stripe Connect Express or Custom, a local bank or payroll provider, or manual bank transfers with reconciliation) | Decides onboarding, liability for losses, fees, webhooks and how payouts are reconciled | None chosen. No provider client, keys or webhook handling for payouts |
| 4 | **Payout currency**, and whether it may differ from the fare currency | Ledger amounts are in the fare currency; converting needs rates, timing and who bears the difference | Only `usd` is supported, with the currency stored on every ledger row |
| 5 | **Driver onboarding for payouts**: who collects identity, bank and tax details (the provider's hosted flow or the app), what is required before the first payout, and how it relates to the existing document review | Payouts can't be sent to an account that hasn't been verified by the provider | Driver verification covers the right to drive only; it collects no payout details |
| 6 | **Responsibility for refunds and card disputes** after earnings are recorded or paid out: whether the platform absorbs them, recovers them from the driver's future earnings, or writes them off; and who pays dispute fees | Decides whether a driver's balance can go negative and how a payout is reduced or reversed | Refunds already create negative ledger adjustments for the driver. Disputes are flagged for review, and dispute fees aren't charged to drivers |

Further decisions that shape the implementation:

7. **Driver status and eligibility.** Whether drivers are contractors or employees, what identity and tax information must be collected before the first payout (and who collects it), and whether a suspended or deleted driver can still be paid what they are owed.
8. **Commission.** The current commission value is a development placeholder recorded per ride. The real rate, and whether it differs by vehicle category or area, is a commercial decision.
9. **Schedule and thresholds.** Daily, weekly or on-demand payouts; minimum payout amount; instant-payout fees, if any.
10. **Holds and negative balances.** How long earnings are held against refunds and card disputes; what happens when refunds or disputes exceed what a driver is owed (carry forward, recover, or write off).
11. **Tips.** Whether tips are paid in full, on the same schedule, and how tip refunds and disputes are recovered.
12. **Who pays processing and payout fees,** and how they are shown to drivers.
13. **Records, statements and retention** required for drivers and tax authorities.

## Integration points for a provider

Once the decisions above are made, a provider would connect at these points. Each step must be idempotent and audited like the existing payment code.

- **Onboarding:** a provider account reference stored against `driver_profiles`, created from the driver app through a hosted onboarding link, with its status read from provider webhooks. The account would be a payout requirement alongside the existing verification requirements, never a replacement for them.
- **Payable balance:** calculated from `earning_entries` only, with a hold window, as a derived value or a new append-only ledger table. It must not be a second, independently edited balance.
- **Payout runs:** a scheduled job, like the existing sweep, that creates one payout per driver per period with an idempotency key from the period and driver, records the ledger rows it covers, and moves them to paid only when the provider confirms.
- **Webhooks:** the existing Stripe webhook handler pattern (signature check, event de-duplication, async processing) extended for payout and transfer events, including failed and reversed payouts.
- **Operator console:** a read-only payouts view first. Any manual adjustment must be a new ledger row with a reason and an audit entry, never an edit.
- **Dashboard:** `paidOutCents` should be filled from confirmed provider payouts only.

## Accounting rules any implementation must keep

1. **One source of truth.** Driver amounts come from `earning_entries`. No parallel balance may be edited on its own.
2. **Append-only.** Corrections, refunds, disputes and payout reversals are new rows. Existing rows are never changed.
3. **Balance.** For every ride, captured fare = commission + driver share, and refunds and adjustments must balance the same way.
4. **Paid only when confirmed.** Nothing is shown as paid out until the provider confirms the payout, and a reversed payout must show the money as owed again.
5. **Idempotency.** Every provider call has a deterministic idempotency key, and every webhook is processed once.
6. **Currency.** Amounts are integer minor units with the currency stored on each row, and currencies are never mixed in one sum.
7. **Privacy.** Bank and tax details stay with the provider. The app stores only provider references and statuses.
8. **Audit.** Every operator action that affects money records who did it, when, why, and the before and after.

## Verification still needed when payouts are built

- Test-mode payouts against the chosen provider, including failed and reversed payouts.
- A reconciliation report comparing provider payouts with ledger totals for each period.
- Refund and dispute scenarios that land after a payout has been made.
