# Operations guide

How to configure, deploy, monitor and recover the service. Nothing here has been exercised against a production host; it describes what the code expects.

## Configuration checklist

`GET /api/ready` and the console's **System** page evaluate this list. Only whether a value is present is reported; secret values are never returned.

| Area | Variable | Level | Effect when missing |
| --- | --- | --- | --- |
| Database | `DATABASE_URL` | required | Nothing works |
| Clerk | `CLERK_SECRET_KEY` or `CLERK_JWT_KEY` | required | No session can be verified |
| Clerk | `CLERK_SECRET_KEY` | recommended | Account deletions cannot delete the sign-in identity and stay pending |
| Clerk | `CLERK_AUTHORIZED_PARTIES` | required in production | Tokens from any origin are accepted |
| Payments | `PAYMENT_MODE` | optional | Defaults to `in_vehicle`: passengers pay the driver by terminal or cash and Stripe is not used. `card_online` restores the Stripe flow |
| Payments | `APP_CURRENCY` | optional | Defaults to `all` (lek) for new fare policies; `usd` for card mode |
| Stripe | `STRIPE_SECRET_KEY` | required only with `PAYMENT_MODE=card_online` | No card bookings |
| Stripe | `STRIPE_WEBHOOK_SECRET` | required in production only with `PAYMENT_MODE=card_online` | Only the sweep recovers payment state |
| Scheduler | `CRON_SECRET` (16+ characters) | required | The sweep endpoint refuses every call |
| Google Routes | `GOOGLE_ROUTES_API_KEY` | required | Quotes are refused, never guessed |
| Trip PIN | `RIDE_PIN_SECRET` (32+ characters) | required in production, recommended in development | No trip PIN is issued in development; production readiness fails |
| Scheduled requests | `SCHEDULED_RIDE_MIN_LEAD_MINUTES` (25–1440, default 30), `SCHEDULED_RIDE_MAX_DAYS` (1–30, default 7) | optional | Defaults are used; a value outside the range is ignored |
| Document storage | `DOCUMENT_STORAGE_BUCKET`, `DOCUMENT_STORAGE_ACCESS_KEY_ID`, `DOCUMENT_STORAGE_SECRET_ACCESS_KEY` | recommended | Driver document uploads and support attachments answer 503; support still works as text |
| Push | `PUSH_NOTIFICATIONS` | optional | `off` disables push; the in-app inbox still works |
| Public URL | `EXPO_PUBLIC_SERVER_URL` | required in production (https) | App builds cannot reach the API; share links point at a development address |

Client-side values (`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_GOOGLE_API_KEY` for address search) are compiled into the app. No server secret may use the `EXPO_PUBLIC_` prefix.

### Development settings that must change before real use

| Setting | Development value | Before real passengers |
| --- | --- | --- |
| Fare rates and currency | Placeholder USD rates in the seeded example area | Set by the operator in the console; a commercial decision |
| Commission policy | 0% default | A commercial decision |
| Service areas | One small labelled example | Draw the real areas |
| Payments | Paid in the vehicle, recorded by the driver | Agree how terminal payments are reconciled with the bank's terminal statement, and how often drivers are paid |
| Fare rates | Placeholder lek rates in the seeded example area | Set by the operator in the console; a commercial decision |
| Stripe (card mode only) | Test keys | Live keys only after legal and payout decisions; console refunds stay disabled on a live key |
| Driver approval | CLI waiver available | Review real documents in the console |
| Clerk | Development instance | Production instance and authorised parties |
| Vehicle categories | The migrated **Standard** category and one seeded development example | Define the real categories, capacities and their fare policies; a commercial decision |
| Service-area time zone | `UTC` for areas created before scheduling existed | Set each area's IANA time zone in the console before offering scheduled requests |
| Trip PIN secret | Placeholder in `.env.example` | A random value of 32 or more characters, kept with the other server secrets |

## Health and readiness

| Endpoint | Auth | Answer |
| --- | --- | --- |
| `GET /api/health` | none | `200 {"status":"ok"}` when the process is serving requests. It does not touch the database |
| `GET /api/ready` | none | `200` when the database answers, the schema is at least at migration 017, and every required setting is present; otherwise `503` with `checks: { database, schema, configuration }` as booleans |
| `GET /api/admin/system` | operator (`view`) | Configuration checklist, background job status, queue and usage counters |
| `GET /api/admin/dashboard` | operator (`view`) | Live and period figures, counts only, in UTC |

Use `/api/health` for liveness and `/api/ready` for load-balancer readiness.

## Background work

`POST /api/internal/sweep` with `Authorization: Bearer $CRON_SECRET`, every minute.

- A database lease (`mobility.job_status`, 120 seconds) lets only one sweep run at a time. A second caller gets `200` with `skipped: "already_running"`.
- Each maintenance step is recorded separately with its last success and last error, visible on the System page.
- Driver heartbeats also run maintenance, throttled to once every 20 seconds, so a missing scheduler degrades the service rather than stopping it. Do not rely on that in production.
- Steps: advance searches and offers, retry settlements, open or expire scheduled requests, deliver and check notifications, delete stored documents and support attachments that are due, purge expired chat, process account deletions, prune rate-limit counters.
- Scheduled requests depend on this job. Confirmation opens 20 minutes before the pickup time and closes 10 minutes after it. If the sweep doesn't run in that window, the request expires without a charge and the passenger is told. Nothing is dispatched late.

## Rate limits

Counted per user (or per token for public share views) in `mobility.rate_limits`, fixed windows. A refused request answers `429 RATE_LIMITED` with `Retry-After`.

| Action | Limit |
| --- | --- |
| Saved-place writes | 60 per 10 minutes |
| Profile writes | 30 per 10 minutes |
| Document upload tickets | 30 per 10 minutes |
| Safety reports | 10 per hour |
| Support requests | 10 per hour |
| Share-link creation | 20 per hour |
| Scheduled-request writes | 20 per hour |
| Public share-link views | 120 per minute |
| Account deletion attempts | 5 per hour |

Quotes, chat messages and support replies have their own limits described in the README. These limits protect the database and third-party quotas; they are not a replacement for network-level protection.

Redis and WebSockets are not used. Long polling plus PostgreSQL is adequate at the scale this project has been tested at; the README's Realtime limitation describes when to change that.

## Deployment

1. Build: `npm run build:admin` writes `dist/client` and `dist/server`.
2. Database: `npm run db:migrate` against the target database. Migrations are additive and tracked in `public.mobility_schema_migrations`. Take a backup first.
3. Host `dist/` on a Node host that supports Expo Router API routes. Set the server-only variables there.
4. Check `GET /api/ready` returns `200`.
5. Register the Stripe webhook and schedule the sweep (see the README's deployment section).
6. Grant the first operator from the CLI, sign in to `/admin`, open **System**, and clear every "Missing" line.
7. Create service areas and fare policies. Nothing can be quoted until one area is active with a policy in effect.

Roll back by redeploying the previous build. Migrations 013–017 only add tables, columns and indexes, so the previous build keeps working against the newer schema.

Migrations 018–024 are additive except for three changes to existing objects: `support_requests.ride_id` becomes nullable, the support category check accepts the driver categories, and `fare_policies_effective_idx` is rebuilt to include the vehicle category. A build from before 018 keeps working against the newer schema, with two cautions: it does not know about trip PINs, stops or categories, so rides created by the newer build with stops or a PIN must be finished on the newer build; and it must not be used to create fare policies, because it would put every policy in the default category.

### Deploying the trip PIN, categories, stops and scheduling

1. Set `RIDE_PIN_SECRET` before deploying. Changing it later invalidates the PINs of rides that are between acceptance and pickup; those passengers would need a waiver. Rotate it only when no rides are in that state.
2. Run `npm run db:migrate`. Migration 021 places every approved or suspended driver in the **Standard** category and assigns existing fare policies to it. Check the category list and the driver pages afterwards.
3. Rides that were active during the deployment have no PIN, no stops and no category. They finish under the old rules.
4. Set each service area's time zone before telling passengers about scheduled requests.
5. Confirm the sweep is running every minute; scheduled requests depend on it.

## Backup

The database is the system of record: rides, payment state, the earnings ledger, audit history and support cases. Stripe remains the source of truth for money actually moved.

- Enable point-in-time recovery on the PostgreSQL provider, or schedule `pg_dump --schema=mobility --schema=public` at an interval that matches how much data you can afford to lose.
- Back up the document bucket separately, with the same access restrictions as the bucket itself. A backup containing identity documents is as sensitive as the originals.
- Store backups encrypted and test a restore before relying on them.
- Backups keep data that was later deleted on request. Decide how long backups are kept and say so in your privacy notice; this code does not set that period.

## Recovery

| Situation | What to do |
| --- | --- |
| Database restored to an earlier point | Run the sweep. For each ride changed after the restore point, use **Refresh from Stripe** in the console so refunds and disputes are re-imported. Captures and releases are re-read from Stripe by the sweep |
| Missed Stripe webhooks | The sweep re-reads every unsettled PaymentIntent; refunds and disputes need **Refresh from Stripe** per ride |
| Sweep not running | The System page shows the last start. Check the scheduler and `CRON_SECRET`. A lease left by a crashed run expires after 120 seconds |
| Notifications failing | System page counters; failed rows stay in `mobility.notifications` with their error. The inbox is unaffected |
| Account deletion stuck | System page shows failing deletions. The usual cause is a missing `CLERK_SECRET_KEY` or a Stripe outage. The job retries with backoff from 1 minute up to 6 hours; application data was already removed when the user confirmed |
| Document deletion failing | System page counter; the worker retries. The file is never served once its row is deleted |
| Google Routes outage or quota | Quotes are refused with a clear message; matching falls back to straight-line order; ETAs are labelled estimates |
| Driver can't start a trip because of the PIN | The driver's screen shows attempts left and the lock. After three locks the driver is told to contact support. An operator with `support` opens the ride in the console and waives the PIN with a reason; the passenger is notified. Cancelling so the passenger is re-matched also clears it |
| Scheduled request not opened | Check the sweep's `scheduled_rides` step on the System page. Requests whose window has passed expire without a charge; the passenger can request a ride now |
| Support attachment won't open | Links last 60 seconds; open it again. If storage is unreachable, the System page shows failing deletions and uploads answer 503 |
| Driver didn't record the payment | After two hours the trip appears in the review queue as "Payment not recorded". Ask the driver, then record it on the ride page with a note |
| Trip reported unpaid | The passenger is blocked from new requests. On the ride page, record it as paid (terminal or cash) or close it without a payment, with a note |
| Transfer recorded by mistake | Records can't be edited. Record a transfer in the other direction for the same amount, with a note explaining it |
| Dashboard section unavailable | The page shows which group failed instead of zeros. Refresh; if it persists, check the database and the server log line `dashboard_section_failed` |

## Account deletion and retained records

Deletion requires a password re-verification within the last 10 minutes and is refused while the user has an active ride, is online as a driver, has a payment still settling, or holds an operator role.

Removed immediately, in one transaction: display name, language, saved places, notification preferences (including quiet hours), push tokens, inbox items, upcoming scheduled requests, the user's chat messages, rating comments written by the user, unused quotes, the passenger name on past rides, driver vehicle plate and display name, driver location. Trip share links are revoked. Driver documents and support attachments are scheduled for deletion by the storage worker. The driver profile is closed and its vehicle categories are removed.

Then, with retries: the Stripe customer and the Clerk identity. Until both succeed the deletion shows as pending; the account cannot be used in the meantime, and a new sign-in with the same identity is refused.

Retained without the person's name: rides, payment and refund records, disputes, receipts, the earnings ledger, safety reports, support requests and their messages, operator audit history, and the record that a deletion happened (with a one-way hash of the identity so it cannot be reused to reopen the account).

### Support attachments

| Case | When the file is deleted |
| --- | --- |
| Uploaded but never sent | 24 hours after upload |
| Sent on a request | 90 days after the request is resolved; reopening the request cancels the timer |
| Account deleted | Scheduled at once |

These periods are implementation defaults in `SUPPORT_RULES`, chosen so files don't accumulate. They are separate from driver-document retention and are not legal advice; change them to match your policy. The message text of a support request is retained as described above.

**No retention period is implemented for the retained records.** How long financial, safety and audit records must or may be kept depends on the operating country and is a legal decision for the service owner. Until that decision is made the records are kept indefinitely, and this must be disclosed to users.

## Payment in the vehicle and driver transfers

- Passengers pay the driver on the business's card terminal or in cash. The app charges nothing and stores what the driver or an operator records.
- **Daily routine.** Check the review queue for "Reported unpaid" and "Payment not recorded". Compare the day's terminal statement from the bank with the dashboard's "Collected on terminals" figure for the same UTC period; the app can't do this comparison.
- **Paying drivers.** On **Driver balances**, a positive balance is owed to the driver. Make the bank transfer outside the app, then record it with the bank reference. A negative balance means the driver owes commission on cash trips; record it when received.
