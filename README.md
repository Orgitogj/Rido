# Uber Clone

A two-sided ride-hailing app built with Expo (React Native), Expo Router API routes, PostgreSQL, Clerk, and Stripe.

Passengers request rides. Approved drivers go online, get offers, accept them, and move the trip through its stages. The server owns identity, pricing, matching, ride state, and payment state. Clients only display that state and ask to change it.

## What is real and what is not (yet)

| Area | Status |
| --- | --- |
| Accounts | **Real**: Clerk email + password with email verification. |
| API authentication | **Real**: every route except the Stripe webhook and cron sweep verifies the Clerk session token. The user, their role, and ride ownership are derived on the server. |
| Drivers | **Real accounts, reviewed by a person**: a signed-in user enters vehicle details and uploads identity, licence, registration and insurance files to private storage; an operator checks them by eye in the console and approves, requests changes, rejects or suspends with a recorded reason. Nothing is verified automatically, and no client can grant driver access. See [Driver verification](#driver-verification). |
| Driver location | **Live from the driver device**: sent about every 5 s while the driver is online or on a ride. Positions are validated on the server and shown only to the assigned passenger, with their age. Background sharing works in development builds; Expo Go is foreground-only. See [Driver location](#driver-location). |
| ETA and route | **Routed when configured**: Google Routes API on the server, cached and throttled. Without a key, when the per-minute budget is used, or when it fails, a labelled straight-line estimate is shown for the *ETA only*; prices never use it. |
| Notifications | **Real (development builds)**: Expo push for offers and trip milestones, through a deduplicated outbox. Not available in Expo Go on Android. |
| Service areas | **Operator-managed, off by default**: quotes are refused unless the pickup is inside an active area with a fare policy in effect. The seed has one small, clearly labelled development example. |
| Matching | **Real, deterministic, road-ranked**: a straight-line prefilter, then up to 10 drivers compared by road time to the pickup with the Google Route Matrix; straight-line order is the fallback during provider problems. See [Matching rule](#matching-rule). |
| Pricing | **Road-based quote with a versioned fare policy**: the server gets the driving distance and time from the Google Routes API and prices them with the fare policy of the pickup's service area, in integer cents. There is no straight-line fallback for prices. **Rates and currency are development placeholders (USD)** until you set real ones. See [Service areas and road-based quotes](#service-areas-and-road-based-quotes). |
| Payments | **Stripe test mode, authorize then capture**: a card hold is placed at request time and charged only when the trip completes. See [Payment lifecycle](#payment-lifecycle). |
| Updates | **Long polling**: about 1 s latency for ride status and driver position, with version cursors, reconnect recovery, and a 3 s polling fallback. See [Live updates](#live-updates). |
| Driver earnings | **Ledger only, no payouts**: earnings are recorded when Stripe confirms a captured fare or a paid tip. Nothing is transferred to drivers. See [Driver earnings and tips](#driver-earnings-and-tips). |
| Tips | **Stripe test mode, separate charge**: optional, confirmed by the passenger in the payment sheet. |
| Profile and saved places | **Real**: name, email and password changes (through Clerk), language, Home, Work and custom places stored on the server. See [Accounts, inbox, support and deletion](#accounts-inbox-support-and-deletion). |
| Inbox and support | **Real**: an in-app notification inbox with push preferences, and a support conversation per request with operator replies. |
| Account deletion | **Real, with documented retention**: personal data is removed at once; financial, safety and audit records are kept without the name. No retention period is set. |
| Languages | **English and Albanian** for the passenger and driver app. The operator console is English only. The Albanian text has not been reviewed by a translator. |
| Demo drivers | The four seeded "demo drivers" from the first version are **simulated**. They are kept only so bookings made with the old demo flow still display, labelled "Demo booking (simulated driver)". They are never matched to new requests. |

## Ride lifecycle

The server enforces every transition in `server/lifecycle.ts`. Each change is checked against the table below, bumps the ride's `version`, and is recorded in `mobility.ride_events` with the actor.

```
awaiting_payment ──(card hold confirmed)──▶ requested ──(offer)──▶ offered ──(driver accepts)──▶ accepted
       │                                     ▲    │                  │ │
       │                                     ├────┼── decline / offer expired / driver offline
       ▼                                     │    ▼                  ▼
   cancelled                                 │  no_driver         cancelled
                                             │
accepted ─▶ arriving ─▶ arrived ─▶ in_progress ─▶ completed      (assigned driver only, no skipping)
   │            │          │            └──▶ interrupted          (assigned driver ends the trip early)
   ├────────────┴──────────┴──▶ requested                        (driver cancels: re-match, same ride + hold)
   └────────────┴──────────┴──▶ cancelled                        (passenger; or driver after the re-match limit)
```

| From → to | Who |
| --- | --- |
| awaiting_payment → requested | system (Stripe reports the hold) |
| awaiting_payment → cancelled | passenger, system (checkout abandoned for 15 min) |
| requested → offered, offered → requested, → no_driver | system |
| requested / offered → cancelled | passenger; system when the card hold is about to expire |
| offered → accepted | the driver holding the offer |
| accepted → arriving → arrived → in_progress → completed | assigned driver |
| accepted / arriving / arrived → requested | assigned driver cancels, re-match allowed |
| accepted / arriving / arrived → cancelled | passenger; assigned driver when the re-match limit is reached |
| in_progress → interrupted | assigned driver, with a reason |

`completed`, `cancelled`, `no_driver`, `interrupted`, and `legacy` are final. Repeating the current status, or cancelling an already-ended ride, returns the current state instead of an error, so duplicate taps are harmless.

## Cancellation and payment rules

There are **no cancellation fees** in this phase. Before anyone confirms, the app shows the server-computed consequence (`RideView.cancellation`), so the wording always matches what the server will do.

| Who | Ride state | Action | Result | Money |
| --- | --- | --- | --- | --- |
| Passenger | awaiting_payment | Cancel | cancelled | PaymentIntent cancelled; any hold released |
| Passenger | requested, offered | Cancel | cancelled; pending offer withdrawn | Hold released, no charge |
| Passenger | accepted, arriving, arrived | Cancel | cancelled; driver notified | Hold released, no charge |
| Passenger | in_progress | none | Contact support from the receipt | Charged on completion |
| Driver | accepted, arriving, arrived | Cancel | **Re-match** (see below) | Same hold kept; nothing new authorized |
| Driver | in_progress | End trip early (reason required) | **interrupted**; flagged for review | Hold released, no charge |
| System | requested, offered | Search deadline | no_driver | Hold released |
| System | requested, offered | Hold expires within 1 h | cancelled (`authorization_expiring`) | Hold released |
| System | assigned or in_progress | Hold expires within 1 h | Flagged for review; trip continues | See expiry rule |

**Re-matching.** When the assigned driver cancels before pickup:
- The same ride, with the same PaymentIntent and hold, goes back to `requested`.
- The driver's accepted offer becomes `withdrawn`, the driver is detached, and the cached route is deleted. The old driver's location stops being visible to the passenger at once, and the old driver gets 404 on the ride.
- The search gets a new **120 s** deadline. Drivers who declined, let the offer expire, or cancelled this ride are never offered it again. All other matching rules still apply (availability, location freshness, 15 km, 20 s offers, one active ride per driver).
- A ride can be re-matched at most **2** times. A third driver cancellation ends it as `cancelled` and releases the hold.
- If no replacement accepts before the deadline, the ride ends as `no_driver` (`no_replacement_driver`) and the hold is released.
- The passenger is notified ("Finding you another driver"), then of the new acceptance.

**Rules for money and wording.**
- **Stripe is the source of truth.** A payment status changes only from a PaymentIntent fetched from Stripe on the server. Captured and refunded amounts come from Stripe (`amount_received` and refunds reported as `succeeded`), never from the app.
- **A release is not a refund.** Releasing an uncaptured hold is called a release, never a refund.
  - Until Stripe confirms the cancellation, the app and receipt say the hold **"is being released"**.
  - "You were not charged" is shown only after Stripe returns the PaymentIntent as `canceled`. The passenger then gets a "Hold released" notification.
  - The transition-time notifications (driver cancelled, no driver, trip ended early) never claim "not charged".
- **Outages.**
  - If a capture or release fails, the ride's state still changes. The settlement is retried with exponential backoff (30 s doubling up to 1 h) by the sweep, refresh, and webhook.
  - The ride shows `settlement: "retrying"`, and each failure is written to the payment ledger.
  - After 6 failed attempts the ride is also flagged for operator review, and retries continue.
  - Capture and release use idempotency keys, and webhook deliveries are deduplicated by event id, so retries and replays never double-charge.
- **Authorization expiry.**
  - When the hold is placed, the server stores Stripe's `capture_before`, falling back to 7 days minus 1 hour.
  - Past that time, the server first asks Stripe for the PaymentIntent's state, and captures only if Stripe still reports `requires_capture`.
  - If Stripe has expired the hold (`canceled`, reason `automatic`), the payment becomes `expired` and no capture is attempted. The ledger records `capture_skipped_expired`, the trip is flagged for review, and the receipt says the authorization expired without a charge.

**Trip payment record.**
- Every Stripe outcome and operator action is appended to `mobility.payment_events`: authorized, captured, released, expired, refund requested, refund succeeded or failed, settlement failed, capture skipped.
- Each ride stores `captured_cents`, `refunded_cents`, `settled_at`, the settlement attempts and last error, and a review flag with a reason.

## Matching rule

A driver is eligible for a ride when all of the following hold:

1. The driver profile is `approved`, its approval hasn't expired, and it is `online` (see [Driver verification](#driver-verification)).
2. The driver app checked in within the last 45 s (heartbeat).
3. The driver reported a location within the last 10 min.
4. That location is within 15 km of the pickup (straight line).
5. The driver has no assigned ride and no other pending offer.
6. The driver hasn't already been offered this ride.
7. The driver isn't the passenger.

Eligible drivers are then ranked by **road travel time to the pickup** (see [Road-based matching](#road-based-matching)), falling back to straight-line distance, then driver id, so the same inputs always produce the same order. The ride is offered to **one driver at a time for 20 s**. On decline, expiry, or the driver going offline, it moves to the next driver. If nobody accepts within **2 minutes**, the ride ends as `no_driver` and the card hold is released. Drivers who come online during a search are offered waiting rides.

Postgres enforces the guarantees:
- **One pending offer per ride.** A partial unique index.
- **One pending offer per driver.** A partial unique index.
- **One active ride per driver and per passenger.** Partial unique indexes.
- **Accept, cancel, expire, and advance serialize.** Each locks the ride row (`SELECT … FOR UPDATE`) in one transaction.

Together these mean exactly one driver can be assigned.

Time-based steps (offer expiry, next offer, search deadline) happen whenever the ride is read, on every driver heartbeat, and on `POST /api/internal/sweep`. A search therefore keeps moving even if the passenger closes the app. In production, point a scheduler at the sweep route (see [Deploying](#deploying-the-api)).

## Payment lifecycle

| Ride state | Stripe PaymentIntent (manual capture) | Payment status |
| --- | --- | --- |
| awaiting_payment | created; PaymentSheet confirms it | pending → authorized |
| requested … in_progress (including re-matches) | card hold (`requires_capture`) | authorized |
| completed | **captured** (hold still valid) | paid |
| completed, hold already expired | not captured | expired (flagged for review) |
| cancelled / no_driver / interrupted | **cancelled** (hold released) | cancelled |

- Money is only taken when the driver completes the trip. Every other outcome releases the hold.
- `paid`, `cancelled`, and `expired` are final. An `authorized` hold can only become one of them, so out-of-order webhooks can't move a payment backwards.
- Amounts come from the stored quote in integer cents and are checked against Stripe before being recorded.
- **Not in this phase:** cancellation fees, tips, fare adjustments, driver payouts, and re-authorizing holds on trips longer than the card's hold window.

## Service areas and road-based quotes

### Service areas

- An area is a polygon of 3–100 points (latitude, longitude) with an **active/inactive** status and a **drop-off rule**:
  - `inside_area`: the destination must be in the same area (the default);
  - `anywhere`: any destination the road route reaches, within the 150 km trip limit.
- The server rejects boundaries that cross themselves, repeat a point, enclose no area, leave valid coordinates, or span more than 150 km in either direction. The size limit is a guard against enabling a whole country by mistake, not a business rule; change `AREA_RULES` in `shared/serviceArea.ts` if you need larger areas.
- Every quote checks, on the server and before any routing call:
  1. The pickup must be inside an active area. If not: `422 PICKUP_OUTSIDE_SERVICE_AREA`.
  2. The destination must satisfy that area's drop-off rule. If not: `422 DESTINATION_OUTSIDE_SERVICE_AREA`.
  3. If areas overlap, the earliest-created area whose rule accepts the destination is used.
  A point on the boundary (within 1 m) counts as inside.
- **Nothing is enabled by default.** Migration `012_service_areas_fares.sql` creates no areas. `npm run db:seed` adds one **development example**: code `dev-example-sf`, about 5 × 6 km of downtown San Francisco matching the test coordinates, with a development policy. It is labelled as such everywhere and is not a launch area. For device testing where you are, create your own small area in the console.
- Deactivating an area stops new quotes and new bookings there (`409 SERVICE_AREA_UNAVAILABLE` for a quote issued earlier). Rides already requested continue and keep their price. Moving a boundary affects only new quotes.

### Fare policies

- Each area has numbered, **immutable** policy versions. A version records:
  - label;
  - development flag;
  - currency;
  - base, per-km, per-minute and minimum fare in cents;
  - effective date, reason and the operator who created it.
- To change prices, schedule a new version with an effective date. The date must not be in the past; "now" is allowed. A version that hasn't started can be cancelled with a reason. One that has started can't: schedule another.
- A quote uses the version in effect when it is created: the latest effective date not after the quote time.
- **Fare formula** (`server/fares.ts`), in whole cents:

  ```
  distance = round_half_up(distance_m × per_km_cents / 1000)
  time     = round_half_up(duration_s × per_minute_cents / 60)
  fare     = max(minimum_fare_cents, base_cents + distance + time)
  ```

  Each component is rounded half up to a whole cent, using integer arithmetic only. The quote stores the breakdown (`base_cents`, `distance_cents`, `time_cents`, `minimum_applied`).
- **Development settings.** The only currency is **USD**, enforced by the database and used by Stripe, tips, receipts and earnings. The seeded and test rates are placeholders:
  - $2.50 base;
  - $1.20/km;
  - $0.30/min;
  - $5.00 minimum.

  They are labelled "development" in the console. Choosing real rates, and supporting another currency, are business decisions this build doesn't make. Another currency needs a separate change across payments.

### Quote flow

1. Validate the input, then reject pickup and destination closer than 200 m (straight line) before spending a routing call.
2. Check the service area and find the fare policy in effect. If there isn't one: `503 PRICING_NOT_CONFIGURED`.
3. Reuse an identical quote from the same passenger if it is less than 60 s old and at least 5 minutes from expiring (`200`, same quote id). "Identical" means pickup and destination within ~1 m, same policy, not yet booked. This avoids paying for repeated taps.
4. Enforce a per-passenger limit of 30 new quotes per 10 minutes (`429 RATE_LIMITED`, `Retry-After: 60`).
5. Reserve one unit of the per-minute routing budget. If it's used up: `503 ROUTING_BUSY`, `Retry-After: 60`.
6. Call **Compute Routes** (`DRIVE`, `TRAFFIC_UNAWARE`, field mask `routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline`, 5 s timeout):
   - no route → `422 NO_ROUTE`;
   - timeout, HTTP error or bad response → `503 ROUTING_UNAVAILABLE` with `Retry-After: 15`;
   - no key → `503 ROUTING_NOT_CONFIGURED`;
   - a road distance over 150 km → `422 TRIP_TOO_LONG`.
7. Store the quote, valid for 10 minutes, with:
   - road distance and duration;
   - route source;
   - area;
   - policy id and `pricing_version` (`<area code>/v<version>`);
   - fare breakdown.
8. Booking copies these onto the ride. The PaymentIntent hold is for exactly the quoted fare, so later map, boundary or policy changes can't alter an accepted price. Booking stays idempotent per quote, and an expired quote gets `410 QUOTE_EXPIRED`.

The confirm screen shows one final price, the route distance, the estimated time and how long the price is held, before the card hold. Error states name the problem and offer "Try again" (temporary problems) or "Change pickup or destination" (coverage, no route, trip length).

### Road-based matching

- **Prefilter:** the existing eligibility rules and the 15 km straight-line radius, from the database.
- **Ranking:**
  - Up to **10** of the closest eligible drivers (straight line) are sent to **Compute Route Matrix**. That is 10 origins × 1 destination (the pickup), `TRAFFIC_UNAWARE`, field mask `originIndex,destinationIndex,status,condition,duration,distanceMeters`, 4 s timeout.
  - Drivers are ordered by road time, then straight-line distance, then id.
  - A driver with `ROUTE_NOT_FOUND` is **not offered** the ride.
  - An element with an error status is treated as unknown: the driver keeps a straight-line position after the ranked drivers.
- **No network calls inside the ride lock.**
  - The ranking is computed before the lock and stored per ride in `mobility.match_rankings`.
  - A single-flight claim on the ride row makes concurrent readers skip instead of calling Google again.
  - A snapshot is refreshed at most once a minute while the search runs, and used for at most 2 minutes.
  - Inside the lock, offers read the snapshot and re-check eligibility, so a driver who went offline, got busy or was suspended after ranking is never offered the ride.
- **Failures:**
  - Provider errors, timeouts or an exhausted budget make offers fall back to straight-line order for that attempt, recorded as `ranking_source = straight_line` on the offer.
  - The retry backs off (15 s doubling to 5 min), so an outage never leaves a ride stuck.
  - The existing offer expiry (20 s), 2-minute search deadline, re-matching, cancellation, payment and one-active-ride rules are unchanged.

### API usage, cost and quota controls

- **Compute Routes:** one request per new quote. Reused quotes, invalid input, too-short trips and trips outside coverage don't call it. The live ETA also uses it, at most once per ride leg every 30 s, and only after the driver moves 300 m or the result is 3 minutes old.
- **Compute Route Matrix:** billed per element (origins × destinations). This build sends at most 10 elements per request, at most once a minute per searching ride.
- **Budget:** a per-minute budget shared by all server instances (`mobility.routing_usage`) caps calls. Set it with `ROUTES_MAX_REQUESTS_PER_MINUTE` (default 120) and `ROUTES_MAX_MATRIX_ELEMENTS_PER_MINUTE` (default 300). Google's published defaults are 3,000 queries per minute for Compute Routes and 3,000 elements per minute for Route Matrix.
- **Price tier:** both calls use traffic-unaware routing and only basic fields, which Google documents as its Essentials tier. Traffic-aware routing would move them to a higher tier. Check current prices in the Google Maps Platform console before launch.
- **Estimate:** each searching ride can use up to about 10 matrix elements per minute, plus one route per quote. Set Cloud quotas and budget alerts on the key's project as well; the app's budget is a second line of defence, not a replacement.
- **Key safety:** the server key is read only from `GOOGLE_ROUTES_API_KEY` and is never sent to clients. The mobile bundle contains no pricing controls or policy endpoints; the console pages are web-only.

### Operator workflow

Grant the permission with `npm run admin -- grant-operator <clerkId> --name "..." --permissions view,configure`. Then open **Service areas** in the console.

1. **Create an area.** Give it a code, a name, boundary points (one "latitude, longitude" per line, in order around the edge), a drop-off rule, a development flag and a reason. It starts **inactive**.
2. **Schedule a fare policy.** Enter:
   - a label;
   - development or business-approved;
   - the rates in dollars;
   - the effective time ("now" or `YYYY-MM-DD HH:MM` local);
   - a reason.

   The console shows example fares for 3 km / 10 min and 10 km / 25 min.
3. **Activate the area.** A reason is required, and activation is refused without a policy. Every edit carries the version you loaded; a concurrent edit gets `409 VERSION_CONFLICT`.
4. **Review the history.** Each area records who created and changed it, policy creation and cancellation, activation and deactivation, with reasons and before/after snapshots. Every action, including refusals, is also in the audit log.

### Migration steps

1. Apply `011_document_upload_hardening.sql` and `012_service_areas_fares.sql` to a **development** database with `npm run db:migrate`. Never run them against production without review.
2. Development only: `npm run db:seed` adds the San Francisco development example.
3. Set `GOOGLE_ROUTES_API_KEY` on the server.
4. Create your own area and policy, then activate it.

Quotes created before the migration have no policy fields and expire within 10 minutes. Existing rides keep their price; `pricing_version` is copied onto them from their quote.

### Tests versus the real provider

- **Automated tests** use `FakeRouting`, which returns a fixed 3.1 km / 7 min route and configurable matrix times, failures and unreachable drivers. They show how our server reacts, not what Google returns.
- **Provider parsing** is tested against recorded response shapes built from Google's documentation, with a fake `fetch`:
  - no route (`{}`);
  - HTTP errors and timeouts;
  - `ROUTE_NOT_FOUND` and element error statuses;
  - request field masks.
- **Not verified in this build:** no request has been sent to Google. Real routes, response timing, quota behaviour and billing need a real key and the device test below.

### Two-device test (service areas, prices, matching)

1. On the server, set `GOOGLE_ROUTES_API_KEY`, migrate a development database, and grant yourself `configure`.
2. In the console, create a small area around where the two phones are, schedule a development policy effective "now", and activate the area.
3. **Device A (passenger):**
   1. Pick a destination inside the area. The confirm screen shows the road distance and one price. Check it against the policy formula.
   2. Pick a destination outside the area: you should get "Destination is outside our service area" with "Change pickup or destination".
   3. Pick a destination across water or with no road: you should get "No drivable route".
4. **Device B (driver):**
   1. Go online inside the area. Request from device A. In the console's ride page (or `mobility.ride_offers`), the offer shows `ranking_source = road` and a road time.
   2. With a second driver account online, check that the offer goes to the driver with the shorter drive, not simply the nearer one.
5. **Policy change:** get a quote on device A, schedule a new policy effective in 2 minutes, wait, then book the old quote within its 10 minutes. The card hold equals the old price. A new quote uses the new price.
6. **Deactivation:** deactivate the area. New quotes are refused, and a ride already in progress completes normally.
7. **Outage:** temporarily set an invalid key on the server. Quotes show "Couldn't calculate your route" with **Try again**, and no ride is charged a guessed price.

## Receipts, support, and refunds

- **Passenger receipts.** `GET /api/receipts` and `GET /api/receipts/:id` return only the caller's own rides; anyone else gets 404. Each receipt shows:
  - pickup, destination, and driver;
  - timestamps and the number of driver re-matches;
  - the quoted fare, the charged amount (from Stripe), refunded and refund-pending amounts, and the net total in USD;
  - the ride outcome, and a payment state (`hold_active`, `hold_releasing`, `hold_released`, `hold_expired`, `charge_pending`, `charged`, `partially_refunded`, `refunded`, `no_payment`, `legacy_demo`) with wording that only states what Stripe has confirmed.
  - Legacy demo bookings are marked as such.
  - The receipt screen refreshes every 5 s while a release or charge is pending.
- **Driver trips.** `GET /api/driver/trips` returns only the caller's own completed trips: route, times, distance, and quoted fare. It has no passenger identity and no payment status, charge, or refund data.
- **Support requests.** "Report a problem" on the receipt calls `POST /api/rides/:id/support`, owner only. It stores a support request and **never** changes money. The receipt lists the passenger's own requests (`GET /api/rides/:id/support`): category, status (Received, Being reviewed, Resolved), timestamps, and the reply an operator wrote when resolving. Internal notes, the assigned operator, and history are never sent to the passenger.
- **Refunds.** Refunds are an operator action in the [operations console](#operations-console). There is no refund endpoint in the passenger or driver API, and the CLI no longer refunds.

## Driver earnings and tips

### Commission policy

- The only commission policy lives in `server/earningsPolicy.ts` (`COMMISSION_POLICIES`). It is versioned and dated, and is checked for valid rates and order on every use.
- No rate was defined in this repository, so the only policy is **`dev-0`: a labelled development default of 0%** on fares and on tips. Drivers therefore keep 100% of captured fares and tips until you add a dated policy with your own rate.
- The commission is calculated in integer cents: `commission = round(fare × rate)` with halves rounded up, and `driver share = fare − commission`.
- The policy version, rate, fare, commission and driver share are **stored on each earning record** (`mobility.ride_earnings`). A later policy never rewrites earlier rides.

### When money counts as earned

- **Fares.** A ride earns only when the ride is `completed` **and Stripe reports its PaymentIntent as captured**. The earning is written in the same transaction that records the `captured` payment event.
  - Holds, captures still pending or retrying, cancelled rides, rides with no driver, interrupted rides (never charged) and simulated legacy rides never earn.
  - The earning uses the amount Stripe actually captured.
- **Tips.** A tip counts only after Stripe reports its PaymentIntent as `succeeded`.
- **Refunds.**
  - A succeeded fare refund adds a **negative adjustment**. The original earning is never changed.
  - The adjustment is split between driver share and commission in proportion to the recorded split. It is computed cumulatively, so a series of partial refunds that adds up to the full fare removes exactly the driver's share and exactly the commission.
  - Tip refunds work the same way against the tip.
  - Refunds and dispute withdrawals share one reversal base per charge, so together they can never remove more than the original fare or tip.
- **The ledger** (`mobility.earning_entries`) keeps six kinds of entry apart: `ride_earning`, `tip`, `fare_refund_adjustment`, `tip_refund_adjustment`, `dispute_withdrawal` and `dispute_reinstatement`.
  - Each entry records the gross amount, commission and driver amount in integer cents with currency, plus the policy version.
  - Every entry has a unique source key (`capture:<ride>`, `tip:<tip>`, `refund:<stripe refund>`, `dispute_txn:<stripe balance transaction>`). Webhook replays, sweeps, retries and concurrent requests therefore can't write the same entry twice.
- **Reconciliation.**
  - The sweep fills in any missing entry from the payment ledger: captured rides, succeeded fare and tip refunds, and succeeded tips.
  - The console's ride page shows whether the earnings ledger matches the ride's captured amount, capture event, succeeded fare and tip refunds, tip state, and each dispute's funds withdrawn and reinstated.
- **Earned, adjusted and paid out.** *Earned* is fare share plus tips; *adjusted* is refund adjustments; *disputes* are funds withdrawn minus funds reinstated by card-network disputes; *net* is their sum. **Payouts don't exist yet.** No screen shows a paid-out balance, and the driver screen says plainly that nothing has been paid out.

### Refunds, disputes and reconciliation

**Refund states** (fare and tip refunds alike): `creating` → `pending` / `requires_action` → `succeeded` | `failed` | `canceled`.
- Only `succeeded` changes money. A pending refund shows as "refund pending" on the receipt and in the console, and isn't counted anywhere else.
- If Stripe later reports a succeeded refund as failed or canceled, the ledger is **not** changed automatically. The ride is flagged for review with `refund_reversed`.

**Refunds made outside the app** (Stripe Dashboard or API) are imported the first time they're seen, from a webhook, the sweep, or **Refresh from Stripe** on the console ride page.
- They're recorded with source `stripe`, and fare refunds also add a `refund_requested` payment event.
- A refund on a charge the app doesn't consider paid is flagged `refund_mismatch`.

**Operator tip refunds** (console ride page, **Tip refunds**; needs the `refund` permission; Stripe test mode only):
1. The panel shows the confirmed tip charge, already refunded, in progress, and maximum refundable.
2. The operator enters an amount (full or partial) and a required reason, then reviews and confirms. Each confirmation carries a new idempotency key and the maximum the operator saw.
3. The server locks the tip and rejects the refund if:
   - the tip isn't paid, or it's under an open dispute (`NOT_REFUNDABLE`);
   - another operator refund is in flight (`REFUND_IN_PROGRESS`);
   - the maximum changed (`REFUNDABLE_CHANGED`);
   - the amount exceeds what's left (`EXCEEDS_REFUNDABLE`);
   - the key was reused for a different amount (`IDEMPOTENCY_KEY_REUSED`).
4. A repeat of the same confirmation returns the same refund.
5. If Stripe is unreachable, the refund stays `creating` and the sweep re-submits it with the same Stripe idempotency key.
6. Every attempt is audited with the verified operator, including denied ones (non-operators, missing permission, live key).

**Disputes (chargebacks)** are tracked separately from refunds in `mobility.disputes`, for fares and for tips.
- **Lifecycle:** Stripe statuses are `warning_needs_response`, `warning_under_review` and `warning_closed` (inquiries), then `needs_response` → `under_review` → `won` | `lost`.
- **Every dispute event re-fetches the full dispute from Stripe.** Duplicate, delayed and out-of-order events therefore converge on the same state.
- **Funds:** each withdrawal or reinstatement balance transaction becomes one `dispute_withdrawal` (negative) or `dispute_reinstatement` (positive) entry for the driver. The original earning is never changed.
  - A won dispute's reinstatement adds the money back.
  - A lost dispute keeps the withdrawal.
  - The split follows the recorded commission, like refunds.
- **While a dispute is open,** the fare or tip can't be refunded from the console.
- **Review flags:**
  - A new non-inquiry dispute, or any status change, flags the ride `payment_dispute` in the review queue.
  - The dispute itself is marked **needs review** with a note when the outcome is uncertain:
    - the payment matches no ride or tip;
    - the status or currency is unexpected;
    - Stripe's withdrawn amount differs from what could be applied (for example after refunds);
    - a lost dispute shows no withdrawal yet, or a won dispute hasn't been reinstated yet.
  - In those cases the app doesn't guess an outcome.
- **Operators respond to disputes in the Stripe Dashboard.** The console shows each dispute's status, amount, reason, funds withdrawn and reinstated, and review notes.

**Recovery paths.** The sweep:
- re-checks pending fare and tip refunds after a minute and re-submits tip refunds stuck in `creating`;
- re-fetches open or flagged disputes hourly;
- fills in missing ledger entries.

Operators with `support` can **Refresh from Stripe** on a ride. This lists the refunds and disputes Stripe has for the fare and tip PaymentIntents and applies them, catching anything a missed webhook left out.

### Driver earnings screen

- The Drive screen has **View earnings**, with Today, Last 7 days, Last 30 days or All time.
- **Confirmed earnings:** completed rides, fares captured, platform commission, fare share, tips, refund adjustments, and net.
- **Awaiting payment confirmation:** shown separately and not counted. This covers completed rides whose capture Stripe hasn't confirmed, and tips still processing.
- **Rides list:** a paginated list of completed rides. Each ride shows its state (confirmed, awaiting confirmation or not charged) and a breakdown: fare, commission with rate and policy, share, tip and its state, dated adjustments, and net.
- **Ownership and privacy:** drivers see only their own earnings (`GET /api/driver/earnings…`); other drivers' rides return 404 and non-drivers get 403. Responses contain no passenger identity, card or Stripe identifiers.
- **Totals by period** follow the ledger date: a refund made this week reduces this week's net, even if the ride was last week.

### Tips

- **Who can tip:** only the passenger, only after a **completed and paid** ride, within 7 days. Cancelled, interrupted, unpaid (capture pending) and simulated rides can't be tipped.
- **Amount:** between $1.00 and $50.00, checked on the server. Suggested amounts are 15/20/25% of the fare, rounded to 50¢.
- **Tips go to the driver in full** under the current policy.
- **Consent:**
  - The passenger picks an amount, reviews "Tip $X to <driver>?", and then confirms in the Stripe payment sheet.
  - The server requires `consent: true`, creates a **separate** automatic-capture PaymentIntent for exactly the server-validated amount, and never confirms a payment by itself. Saved cards are never charged silently.
- **Duplicates:** each confirmation carries an idempotency key, and one tip record per ride is enforced by a partial unique index. Stripe calls use `tip-<id>` idempotency keys.
  - A double tap, a retry, or reopening the app returns the same tip and PaymentIntent.
  - A different amount needs the pending tip to be cancelled first (`TIP_IN_PROGRESS`).
  - A paid tip can't be repeated (`TIP_ALREADY_PAID`).
- **Payment states:** status comes only from Stripe: `pending`, `requires_action` (3-D Secure), `processing`, `failed` (declined, retryable on the same PaymentIntent), `succeeded` or `canceled`.
  - If the app closes after paying, the webhook confirms the tip; without it, the sweep checks with Stripe on its next run after one minute.
  - Tips left unpaid for 24 hours are cancelled with Stripe.
- **Where the tip shows:** the passenger receipt shows the tip line with its real state and any refund, and the driver sees it on the earnings screen (paid or processing). An operator sees the tip, its PaymentIntent and the ledger on the console ride page.


## Safety

- **Safety screen.** The ride screen has a **Safety** button for the passenger and the assigned driver (`/safety/<rideId>`).
  - It shows the ride ID and status, plus the driver, vehicle and plate for the passenger, or the passenger's name for the driver.
  - It offers **Report a safety issue** and **Contact support**. For a passenger this opens the ride's support request on the receipt; for a driver it opens the report form with "Something else".
  - It lists the user's own reports and their status.
  - **The app does not contact emergency services.** The screen says so and tells people to call their local emergency number.
- **Safety reports.**
  - Categories: unsafe driving, harassment, vehicle mismatch, accident, other.
  - The description must be 10–2000 characters and can't contain control characters. Each report carries a client report ID, so a retry returns the same report.
  - **Who can report:** the passenger, the assigned driver, and a driver who cancelled out of the ride (a *former* driver). A former driver can report what happened while they were assigned, but no longer sees the passenger's name or the chat.
  - **When:** any time during the ride and up to 7 days after it ends. For a former driver, up to 7 days after they left. Cancelled and interrupted rides can be reported too; simulated demo rides can't.
  - **Privacy:** each report is visible only to its author, never to the other participant, and never with operator notes.
- **Reporting a chat message.** Tap **Report** under a received message (or long-press it).
  - The server checks the reporter can see that message, using the same rule as the chat: a newly assigned driver can't reach a previous driver's messages, and nobody can report their own messages.
  - The server stores the message ID, sequence number, sender role, time, and a snapshot of the text (at most 500 characters) as evidence on the report.
- **Operator triage** (console **Safety** tab; needs the `support` permission, like other case work).
  - The queue is filtered by status, category, ride and date, with pagination.
  - The case page shows the report, the ride's status history, the current driver and vehicle, and **only the reported messages**. The rest of the conversation stays private, and operators can't browse ride chats.
  - Actions: assign to me, mark in review, resolve or dismiss (assigned operator only, note required), reopen (note required), and add a note. Each action checks the report's version.
  - Every action and every case view goes into the report's history and the audit log, with the verified operator. Report descriptions are not copied into the audit log.
- **Evidence retention.**
  - Message snapshots are separate from the chat, so the 30-day chat purge doesn't remove evidence.
  - While a report is open, its evidence is kept.
  - When a report is resolved or dismissed, the evidence is kept for **180 days**. The sweep then removes the snapshot text and records an `evidence_redacted` event; the report itself and its history remain.
  - Reopening a report clears the deadline.
- **Trip sharing** (passenger only, while the ride is requested, matched or in progress).
  - **Create a share link** makes a 256-bit random token and opens the system share sheet. Only the token's SHA-256 hash is stored.
  - Up to 3 links can be active per ride.
  - A link stops working when the passenger taps **Stop sharing**, after **4 hours**, or **30 minutes after the trip ends**, whichever comes first.
  - The public page (`/share/<token>`, no sign-in) calls `GET /api/share/:token` and refreshes every 15 s.
  - **What it shows:** the trip status, the driver's first name, vehicle and plate, the destination, and the driver's position rounded to about 10 m while a driver is assigned and the position is fresh.
  - **What it never shows:** after the trip, no location, destination or driver. It never contains the ride ID, fare, payment, chat, passenger identity or an account session.
  - **Rematches:** the link follows a rematch, showing "Looking for a driver" and then the new driver.
  - Responses send `Referrer-Policy: no-referrer`.

## Ride chat and ratings

### Chat

- **Who can talk.** Only the passenger and the driver **currently assigned** to the ride can exchange text messages. Messaging opens when a driver accepts and stays open through `accepted`, `arriving`, `arrived` and `in_progress`. Before a driver accepts, the passenger sees "waiting" and can't send.
- **Driver replacement.** Every message records the driver assignment it belongs to.
  - When a driver cancels, their access ends at once: all chat endpoints return 404 for them, including retries of messages they already sent.
  - A replacement driver sees **only** messages from their own assignment, never the conversation with the previous driver.
  - The passenger keeps the whole history. Earlier messages are labelled "Previous driver".
- **Ride end.** When the ride completes, is cancelled or is interrupted, the conversation becomes read-only (`CHAT_CLOSED` for new messages). The passenger and the final driver can read it for **30 days** after the ride ends. After that it shows as expired, and the scheduled sweep deletes the message rows in batches.
- **Server rules.**
  - **Length:** 1–500 characters after trimming; line endings are normalized and control characters are rejected.
  - **Ordering:** a per-ride sequence number assigned under a row lock, so order is stable and gap-free across concurrent senders.
  - **Pagination:** `before`/`after` cursors, 30 messages per page, 50 at most.
  - **Idempotency:** each message carries a client-generated UUID. A retry, a double tap or concurrent duplicates return the original message (`200`, `duplicate: true`); reusing the ID for different text is `409 IDEMPOTENCY_KEY_REUSED`.
  - **Rate limits:** 8 messages per sender per 30 seconds (`429 RATE_LIMITED` with `Retry-After`) and 200 per sender per ride (`429 CHAT_LIMIT_REACHED`). The limits are counted in the database, so they hold across server instances.
- **Separate permissions.** Chat authorization only checks ride membership and assignment. It never depends on payment status or location sharing, and chat responses contain no location or payment data.
- **Updates.**
  - The chat screen uses the existing long-poll `watch` route with an extra `chatSeq` cursor, and fetches only messages after its newest sequence. Clients that don't send `chatSeq` behave as before.
  - Reconnects, app restarts and out-of-order responses are handled by merging on server IDs and sequence numbers.
  - Unsent messages stay on screen as "failed". Tapping retries with the same ID, so a retry can't create a duplicate.
  - Read positions are stored on the server, which drives the unread count on the ride screen.
- **Push.**
  - The other participant gets "New message from your driver/passenger" with the body "Open the app to read it."
  - **Message text is never put in the notification**, so nothing leaks on a shared lock screen.
  - Pushes are collapsed to at most one per recipient per ride every 2 minutes, and are suppressed while that conversation is open on the device.
  - Tapping one opens `/chat/<rideId>` only after `GET /api/rides/:id/chat` confirms access, including after a sign-in detour.
- **Operators can't read chats** in this version.

### Ratings

- **Who and when.** After a **completed and paid** trip, the passenger can rate the driver and the driver can rate the passenger, once each, within 7 days of drop-off.
  - Cancelled, interrupted, simulated (legacy demo) and unpaid trips can't be rated. A trip whose capture is still pending becomes rateable once Stripe confirms the payment.
  - Nobody can rate their own ride or someone else's.
- **Scale.** 1–5 stars, plus optional written feedback of up to 300 characters.
- **Edits and duplicates.**
  - One authoritative record per side, enforced by a unique key and a row lock.
  - Duplicate taps and concurrent submissions leave one record.
  - Changes are allowed for **60 minutes** after the first submission; after that the rating is locked (`409 RATING_LOCKED`).
- **Privacy.**
  - Written feedback is visible only to its author and to operators; the rated person never sees it.
  - The other party sees only an average, shown once they have at least **3** ratings whose edit window has closed. Until then it reads "New". This makes it harder to work out an individual score from a fresh change.
  - Riders see their driver's average on the assigned-driver card. Drivers see a passenger's average on the offer card and during the ride, and their own average on the Drive screen.
- **Moderation.**
  - Ratings of 2 stars or less, and any rating with written feedback, enter the operator **Feedback** queue in the console (`/admin/feedback`).
  - Operators with `support` can mark an item reviewed, remove it (removed ratings don't count toward averages), or restore it. Each action needs a reason and the item's current version.
  - Actions are audited without the feedback text.


## Live updates

Expo API routes handle plain requests and responses: the Expo server runtime has no WebSocket upgrade support. Neon's pooled connections also can't use Postgres `LISTEN/NOTIFY`. The ride screen therefore uses **long polling with version cursors**, which works on any HTTP host:

- The app calls `GET /api/rides/:id/watch?version=V&locationSeq=L&routeVersion=R&wait=20`.
- The server checks the database about once a second. It answers as soon as the ride's `version` or the driver's `locationSeq` moves past the cursor, or after `wait` seconds with `changed: false`. Status changes and new driver positions therefore reach the other party in about 1 s.
- **Missed updates can't happen.** Every response is the latest state, not a diff. A client that reconnects with old cursors gets everything current in one response.
- **Stale responses are ignored.** The client drops ride versions and location sequences older than the ones it has.
- **App lifecycle.** The app aborts the request in the background, re-issues it immediately on resume, and after every action, and stops at a final state.
- **Fallback.** After three consecutive watch failures the app switches to plain polling of `GET /api/rides/:id` every 3 s for a minute, then retries the watch. Errors back off up to 15 s.
- **Transport interface.** Screens only depend on `RideUpdateSource` in `lib/rideUpdates.ts`, so an SSE or WebSocket transport can replace long polling where the host supports it.
- **Location is a snapshot, not a history.** Ride status (`RideView`) never contains driver coordinates. The watch response carries a separate `live` snapshot: the latest position only, never GPS history.
- **Cost.** Each waiting client costs about one small query per second, which is fine at demo scale. For larger scale, move to a pub/sub service.

## Driver location

- **When it's sent.** The driver app sends its position **only while the driver is online or has an active ride**:
  - In the foreground, through `watchPositionAsync`, about every 5 s or 15 m.
  - Optionally in the background (see [Development builds](#development-builds-location-and-push)).
- **Stopping.** Going offline stops sharing and deletes the stored position on the server. The server also refuses updates from a driver who is offline without a ride.
- **Permission.** The app explains why location is needed before the OS prompt, and handles denial and disabled location services with a Settings link. It warns about weak GPS (worse than ±100 m) and says when updates aren't reaching the server.
- **Server validation** (`server/location.ts`). Only the approved driver can update their own profile. Coordinates must be in range. A fix is rejected if it is:
  - older than 2 min (`stale`) or more than 30 s in the future (`future`);
  - less accurate than ±500 m (`low_accuracy`);
  - moving faster than 70 m/s from the previous fix (`jump`; allowance for accuracy, and reset after 10 min);
  - older than the stored one (`out_of_order`);
  - less than 2 s after the previous one (`throttled`).
- **Visibility.** Only the ride's passenger and its assigned driver can read the position, and only while the ride is `accepted`, `arriving`, `arrived`, or `in_progress`. Anyone else gets 404.
- **Freshness.** A position under 30 s old is shown as **live**. Up to 5 min it is shown as "updated N min ago". Older positions are hidden ("location unavailable"), so an old position is never presented as live.
- **Legacy.** The only simulated drivers left are the legacy demo drivers attached to old bookings, which are labelled as such.

## ETA and routing

- **Where it runs.** The ETA is computed on the server, in `server/live.ts` and `server/routing.ts`, using the **Google Routes API** with the server-only key `GOOGLE_ROUTES_API_KEY`. The key never reaches the app.
- **Legs.** For `accepted`/`arriving` the ETA is from the driver's position to the pickup. For `in_progress` it is from the driver's position to the destination. At `arrived` the app shows the route to the destination without an ETA.
- **Caching and throttling.** Results are cached per ride and leg in `mobility.ride_routes`. A new routing call happens only if at least **30 s** have passed **and** the driver has moved **300 m**, or if the cache is older than **3 min**. A claim column makes sure only one of several concurrent watchers calls the provider. Location updates alone never trigger routing: it runs only when someone is watching the ride.
- **Fallback.** On provider errors or timeouts (5 s), or without a key, the app uses a straight-line estimate (distance × 1.3 at 25 km/h), labelled "rough straight-line estimate (route unavailable)" and drawn as a dashed line.
- **Presentation.** The ETA is always shown as **estimated** ("Not a guaranteed time"). The fare is fixed at the quoted price and never changes with the ETA.
- **Map.** The route line comes from the server's polyline, and is sent to the app only when it changes. The map fits the route once per leg and when the driver first appears, not on every update. The driver marker animates to each new position. Panning the map stops auto-framing until **Recenter** is tapped.
- **Cost.**
  - Google bills the Routes API per request. The app requests traffic-unaware routing and only duration, distance, and the polyline, to stay in a lower pricing tier. Check Google's current prices and free monthly usage.
  - Worst case is about one call per 30 s per watched, moving ride. Typically that is a few dozen calls per trip.
  - The address search and pre-booking route preview still use the client key `EXPO_PUBLIC_GOOGLE_API_KEY`. Restrict that key by app.

## Notifications

- **Events.**
  - Drivers get a push for a **new offer**.
  - Passengers get one when a driver **accepts**, **arrives**, **starts** the trip, **completes** it, or **cancels**, and when **no driver** was found.
  - A driver is told when the passenger cancels an assigned ride.
  - GPS updates never send a push.
- **Outbox.** Notifications are written to `mobility.notifications` in the **same transaction** as the state change. A unique `dedupe_key` (for example `ride:<id>:arrived:<user>`) means duplicate taps and retries produce one notification.
- **Delivery.**
  - Notifications are delivered through the **Expo push service**, right after each ride transaction and from the sweep.
  - Rows are claimed with `FOR UPDATE SKIP LOCKED`, so concurrent servers never double-send.
  - Failed sends are retried up to 5 times.
  - Notifications that are no longer useful are dropped: offers after 20 s, others after 15–60 min.
- **Tokens.**
  - `POST /api/devices` registers the device's Expo push token for the signed-in user. Registering the same device from another account moves it to that account.
  - Signing out calls `POST /api/devices/unregister`, which only affects the caller's own token.
  - Tokens are disabled when Expo reports `DeviceNotRegistered`, either immediately in the push ticket or in the receipt checked about 15 min later by the sweep.
- **Taps.**
  - A notification carries only `{ kind, rideId, target, recipient }`.
  - The app opens `target` only if it is a known in-app route (a ride, receipt, chat, support request or safety screen by UUID, `/driver`, `/notifications`) and `recipient` matches the signed-in user.
  - When a notification arrives while signed out, the app sends the user to sign in and then to the ride. Deep links (`myapp://ride/<id>`) work the same way.
  - The ride screen is still authorized on the server, so another user's ride id returns 404.
  - Cold starts are handled through `getLastNotificationResponseAsync`.
- **Cost.** Expo's push service is free, with per-project rate limits.

## Development builds (location and push)

Background location and push notifications need a **development build**:
- Expo Go on Android has no remote push since SDK 53.
- Expo Go can't run background location tasks.

In Expo Go the app still works: location sharing is foreground-only, and the driver screen says so. Push is skipped with a message.

1. Install the EAS CLI (`npm i -g eas-cli`), run `eas login`, then run `eas init`. This writes `extra.eas.projectId` to `app.json`; alternatively set `EXPO_PUBLIC_EAS_PROJECT_ID`.
2. **Android push:** create a Firebase project, add an Android app with package `com.orgitogjoci.uber`, and upload an FCM V1 service-account key with `eas credentials`. Download `google-services.json`, add `"googleServicesFile": "./google-services.json"` under `android` in `app.json`, and don't commit the file.
3. **iOS push:** needs a paid Apple Developer account. `eas build` sets up the APNs key when asked.
4. Build and install:
   ```bash
   eas build --profile development --platform android   # or ios
   npm run start:dev-client
   ```
   Local alternative with Android Studio or Xcode installed: `npx expo run:android` / `npx expo run:ios`.
5. **Native configuration is already in `app.json`:**
   - The `expo-location` plugin adds iOS `UIBackgroundModes: location`, the permission texts, and Android `ACCESS_BACKGROUND_LOCATION` and `FOREGROUND_SERVICE_LOCATION` with a location foreground service.
   - The `expo-notifications` plugin sets the notification color.
   - The app creates a high-importance `rides` Android notification channel.
6. **How background location works.** When a driver turns on "Keep sharing in the background", the app asks for "Allow all the time" and starts a TaskManager task (`driver-location-updates`) about every 15 s or 50 m. Android shows a persistent "Sharing your location" notification, and iOS shows the blue location indicator.
   - The task authenticates with the Clerk session held by the running app. If the OS kills the app and the session can't be restored, updates stop and passengers see the position age and then "unavailable" rather than a stale position.
   - Sharing stops when the driver goes offline, the ride ends, or the server reports that sharing is no longer allowed.

## Driver verification

A driver can only go online, receive offers, or accept a new trip when an operator has approved their vehicle and documents and that approval hasn't expired. The checks are done by a person looking at the files. The app does not verify identity or documents automatically, and it doesn't encode the rules of any particular country or city: decide what an acceptable document is for your jurisdiction and write it into your operators' review procedure.

### Application status

| Status | What the applicant can do | Who moves it on |
| --- | --- | --- |
| `draft` | Edit vehicle details, upload and replace documents, submit when everything is in place | Applicant (**Submit for review**) |
| `submitted` | Nothing; details and files are locked while in review | Operator: approve, request changes, or reject |
| `changes_requested` | Read the operator's message and per-document notes, fix them, submit again | Applicant, or operator (reject) |
| `approved` | Go online. **Start an update** (while offline with no active ride) returns the application to `draft` and takes them off the road until it is approved again | Operator: suspend, or approve again |
| `rejected` | Read the message; start a fresh application | Applicant (**Start an update**) |
| `suspended` | Nothing; can't go online | Operator: reinstate |

The application stores what the passenger view needs to identify the car: make, model, colour, plate and seats (model year is optional). The server validates every field (`driverApplicationSchema`); the request is a strict object, so a client can't set `status`, `documentsWaived` or any other review field. Approval is only possible through the operator decision endpoint (or the audited CLI waiver below).

An approval expires the day after the earliest expiry date among the accepted licence, registration and insurance (`approval_expires_at`). Existing drivers approved before this feature were marked as approved with a documented waiver so they keep working; the console shows the waiver, and the next normal approval clears it.

### Documents

| Document | Expiry date |
| --- | --- |
| Proof of identity | Not asked |
| Driving licence | Required |
| Vehicle registration | Required |
| Vehicle insurance | Required |

- JPEG, PNG or PDF, 100 B to 10 MB. The applicant types the expiry date shown on the document; an operator checks it against the file.
- File contents never pass through or live in Postgres. The table holds only object keys, type, size, ETag, expiry and review fields. No key is returned by any API.

### Upload flow

1. **Ticket.** `POST /api/driver/documents` (kind, type, size, expiry) creates a `pending_upload` row. The server returns a 5-minute upload target for a **separate upload key** (`driver-documents/uploads/…`).
   - By default this is a presigned **POST** form. Its signed policy pins the bucket, the exact key and `Content-Type`, and `content-length-range` to exactly the declared size.
   - It can instead be a presigned **PUT** (see [Private storage](#private-storage)).
   - The upload key is always queued for deletion 10 minutes after the ticket expires.
2. **Upload.** The app sends the file straight to the bucket.
3. **Confirm.** `POST /api/driver/documents/:id/complete` runs these checks, and every one happens on our server whatever the bucket enforced:
   1. `HEAD`s the upload key and checks the size, content type and ETag.
   2. Reads the first bytes with `If-Match: <ETag>` and checks the JPEG, PNG or PDF signature. A mismatch deletes the upload and answers `422 FILE_REJECTED`.
   3. Reserves a new **final key** (`driver-documents/files/…`) in the deletion queue.
   4. Copies the upload to that key **only if its ETag is still the one checked** (`x-amz-copy-source-if-match`), and checks the copy.
   5. In one transaction: consumes the reservation, marks the row `uploaded` with the final key, and records the event. If the row was replaced or cleaned up meanwhile, or the reservation is gone, it answers `409` and the copy stays queued for deletion.
4. If the file changes during these steps, the answer is `409 UPLOAD_CHANGED` and the applicant uploads again.

No client ever receives a link that can write to a final key. Reusing an upload link, even before it expires, only writes to the upload key, which is never reviewed and is deleted. Operators only ever see the bytes that passed the checks.

**Replacing** a document marks the earlier uploaded or rejected one `replaced`, and an unfinished upload is closed at once. An accepted document stays in force until the operator accepts its replacement.

### What is enforced where

| Guarantee | Enforced by | Status |
| --- | --- | --- |
| Upload goes only to the one upload key, before the ticket expires | Bucket: signed POST policy or signed PUT URL | Documented S3 behaviour; **needs a real-bucket test** |
| `Content-Type` equals the declared type | Bucket (POST policy `eq` condition, or signed `content-type` header on PUT) and our server after upload | Server check is tested; bucket check **needs a real-bucket test** |
| Size is exactly the declared size (at most 10 MB) | **POST:** the bucket, via `content-length-range`, and our server after upload. **PUT:** our server after upload only | Server check is tested. AWS documents `content-length-range` for POST but documents **no size limit for presigned PUT**, so in PUT mode an oversized file can reach the bucket; it's deleted when confirmation fails or when the upload key expires |
| File signature matches the type | Our server after upload | Tested |
| Reviewed bytes can't be replaced by the applicant | Our server: separate final key, ETag-pinned read and copy | Tested against the fake store; the ETag preconditions **need a real-bucket test** |
| Nothing is approved unless it passed the checks | Our server: only confirmed documents can be accepted | Tested |
| Rejected, replaced and abandoned files are removed | Our server's deletion queue, plus an optional bucket lifecycle rule | Tested against the fake store |

The automated tests use an in-memory store that accepts any upload. They check how our server reacts; they don't show what a real bucket enforces.

### Private storage

Any S3-compatible bucket can be used. Requests are signed with AWS Signature Version 4 in `server/storage.ts`, so no SDK is needed and it runs on EAS Hosting or any Node host.

| Variable | Meaning |
| --- | --- |
| `DOCUMENT_STORAGE_BUCKET` | Bucket name. Keep it **private**: Block Public Access on, no public bucket policy, no public ACLs |
| `DOCUMENT_STORAGE_ACCESS_KEY_ID`, `DOCUMENT_STORAGE_SECRET_ACCESS_KEY` | A key for this bucket only (policy below) |
| `DOCUMENT_STORAGE_REGION` | Defaults to `us-east-1`; R2 uses `auto` |
| `DOCUMENT_STORAGE_ENDPOINT` | Leave empty for AWS. For R2: `https://<account>.r2.cloudflarestorage.com`; for MinIO: its URL |
| `DOCUMENT_STORAGE_FORCE_PATH_STYLE` | `true` for MinIO and R2 |
| `DOCUMENT_STORAGE_UPLOAD_METHOD` | `post` (default) or `put`. Use `post` where the provider supports browser POST uploads with policy conditions (AWS S3; MinIO documents POST policies too). Use `put` for providers without POST Object; Cloudflare R2's S3 API list doesn't include it |

Provider notes:

- **AWS S3:** POST and PUT. `content-length-range` is the documented way to cap an upload's size.
- **Cloudflare R2:** use `put`. R2 lists `x-amz-copy-source-if-match` on CopyObject as supported. The bucket does **not** cap the size in this mode; our server does after upload.
- **Other S3-compatible services** differ. Some accept a POST but don't enforce every policy condition. Test yours with the checklist below before relying on it.

Access-key policy (AWS form; adapt for other providers). `GetObject` covers `HeadObject`, and CopyObject needs `GetObject` on the source and `PutObject` on the destination:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::<bucket>/driver-documents/*"
  }]
}
```

- Recommended: a lifecycle rule that expires objects under `driver-documents/uploads/` after 1 day, as a backstop to the deletion queue. Never apply it to `driver-documents/files/`.
- These are server-only variables. Never prefix them with `EXPO_PUBLIC_`.
- If they are not set, upload and document-view endpoints answer `503 STORAGE_NOT_CONFIGURED` and the app says uploads aren't configured. Everything else keeps working.
- For the web build, allow CORS `POST` (or `PUT` in PUT mode) from your web origin, with the `content-type` header. Native apps don't need CORS.
- Operators get a **60-second** presigned `GET` link for one confirmed file, with `Cache-Control: no-store`. Every request for a link is written to the audit log, whether it succeeds or not.
- Presigned links can't be revoked before they expire. A view link issued in the last 60 seconds keeps working until then, or until the file is deleted. No link is ever issued for replaced, deleted or unconfirmed files.

### Retention and deletion

Deletion goes through a queue in Postgres (`mobility.storage_deletions`), processed by the sweep (`POST /api/internal/sweep`):

1. A single statement marks due rows `deleted` and queues their keys. It locks each row and re-checks its condition, so a document that was confirmed, reopened or replaced at the same moment is left alone.
2. Queued keys are then deleted from the bucket. Failures back off (1 min doubling to 1 h) and are retried.
3. The worker **never deletes a key that a live document points to**. A confirmation that finds its reservation already taken fails instead of pointing at a deleted file.

What is due:

- unconfirmed uploads after 24 hours (the upload key itself goes 10 minutes after the ticket expires);
- the upload key of every ticket, whether used or not;
- files that were replaced, 30 days after the replacement;
- every file of a rejected application, 90 days after the rejection, unless the applicant starts a new application first.

Accepted documents of an approved or suspended driver are kept while the account exists. Deleting an account's documents on request is an operator task at present: suspend or reject, then the retention above applies. Review events and the audit log keep who decided what and why, but no file contents.

### Operator review

Grant the permission with `npm run admin -- grant-operator <clerkId> --name "..." --permissions view,verify`, then open **Drivers** in the console:

1. The queue defaults to **Needs review**: submitted applications, plus approved or suspended drivers who uploaded a new file. Other filters: each status, or all.
2. The application page shows the vehicle, requirements, masked account, active ride (if any), documents with their review state, and the full review history.
3. **View** opens a file through a 60-second link, and the access is recorded.
4. Mark each document **Accept** or **Reject**. A rejection needs a note, which the applicant sees.
5. Choose a decision and enter an internal **reason**, which is required and audited. Every decision except approve and reinstate also needs a **message to the applicant**:
   - **Approve** needs every document accepted and not expired.
   - **Request changes** sends the application back to the applicant.
   - **Reject** closes the application.
   - **Suspend** takes an approved driver off the road.
   - **Reinstate** lifts a suspension.
6. Each decision carries the version the operator loaded. If another operator acted first, the second gets `409 VERSION_CONFLICT` and nothing is saved, including the document choices.
7. An operator can't review their own application (`403 CANNOT_REVIEW_OWN_APPLICATION`).

### Suspension or expiry during a trip

- **Before pickup** (accepted, arriving, arrived): the ride is re-matched to another driver with the same card hold, just like a driver cancellation. After the re-match limit, it is cancelled and the hold released. The passenger is notified ("Your driver can't complete this ride…"), and the ride is flagged for operators as `driver_ineligible_during_trip`.
- **With the passenger on board** (`in_progress`): nobody is stranded. The driver can finish the trip and keeps sharing location; the ride is flagged for operators.
- After that, the driver is taken offline, pending offers are withdrawn, and their stored position is cleared. The sweep and every heartbeat apply this to approvals that have lapsed.

### Passenger privacy

Passengers, and people with a trip-share link, see only the driver's display name, vehicle colour, make and model, plate and seats. They never see identity documents, licence details, expiry dates, storage keys, review notes or messages. None of these are in the app bundle; the release scan checks for storage keys.

### CLI

`npm run admin -- approve <ref> --waive-documents --reason "..."` is kept as a development and recovery override, for local testing without a bucket or if the console is unavailable. It marks the driver as approved **with documents waived**, records the reason as the waiver note, adds a `cli` review event, and writes an audit entry with the OS user. Without `--waive-documents` and `--reason` it refuses. `suspend <ref> --reason "..."` refuses while the driver has an active ride; suspend from the console instead, which handles the ride.

### Manual test

Use made-up test files, never real documents, and a **development** bucket and database. These steps are what show the **bucket's** behaviour; the automated tests don't.

1. Apply migrations up to `011_document_upload_hardening.sql` to a development database. Set the `DOCUMENT_STORAGE_*` variables for a private test bucket (for example a local MinIO: `DOCUMENT_STORAGE_ENDPOINT=http://<LAN IP>:9000`, `DOCUMENT_STORAGE_FORCE_PATH_STYLE=true`).
2. On a device, open **Drive**, fill in the vehicle details including colour, and **Save details**. The status is **Draft** and a checklist shows what's missing.
3. Upload a sample image or PDF for each document; enter an expiry date for licence, registration and insurance. Try a `.txt` renamed to `.pdf`: the server rejects it. **Submit for review**.
4. **Bucket enforcement.** Request a ticket, e.g. by reading one from the network inspector or calling `POST /api/driver/documents` with a session token. Then try each of these; every one must be refused by the bucket (`403` or `400`):
   - **POST mode:** upload a file one byte larger or smaller than declared (`EntityTooLarge` / `EntityTooSmall` expected); change the `key` or `Content-Type` field; submit after 5 minutes.
   - **PUT mode:** send a different `Content-Type`; send after 5 minutes. Then send a larger body and note the result. If the bucket accepts it, confirmation must still fail with `422`, and the object must disappear.
   - Check in the bucket console that nothing under `driver-documents/files/` was created by these tries.
5. **Overwrite.** After a successful confirmation, send a different file to the same upload link. Confirm again: the answer is `200` and nothing changes. In the console, **View** still shows the original file. Ten minutes after the link expires, the sweep removes the upload key.
6. **Public access.** Open a `driver-documents/files/…` object URL without a signature: it must be refused. A console **View** link stops working after 60 seconds.
7. In the console (`/admin/drivers`), as a `verify` operator on a *different* account, open the application, **View** a file, reject one document with a note, and **Request changes** with a message.
8. On the device, read the message, replace the rejected file, submit again. In the console accept all files and **Approve**. The driver can now go online.
9. **Cleanup.** Run the sweep. Rows in `mobility.storage_deletions` whose time has come disappear, and so do their objects. Stop the bucket (or revoke the key) and run it again: `attempts` and `last_error` go up, and the rows are retried after the storage is back.
10. Take a ride with a passenger account. The passenger sees the colour, make, model and plate. Suspend the driver in the console before pickup: the passenger is re-matched and notified. Repeat after **Start trip**: the trip can be completed, and the ride appears flagged for review.
11. Check **Rides → audit** and the application history for every access and decision.

## Operations console

A web console for operators at `/admin`, served by the same Expo web build and API as the app. It is not linked from the mobile app; on Android and iOS the `/admin` routes show only "available on the web".

### Who can use it

- **Every admin request is authenticated with Clerk** (the same bearer session as the app) and then authorized against `mobility.operators` on the server. A signed-in user without an active operator record gets `403 NOT_AN_OPERATOR`; the attempt is audited.
- **The role can only be granted from a machine with database access.** No API route writes `mobility.operators`, and the passenger/driver API ignores any role field. There is no self-service or invitation flow.
- **Permissions** are separate and checked per request:

  | Permission | Allows |
  | --- | --- |
  | `view` (always granted) | Review queue, ride search and details, support requests, audit entries |
  | `support` | Assign support requests, add internal notes, resolve and reopen; mark reviewed rides as resolved |
  | `refund` | Create test-mode refunds and refresh their status from Stripe |
  | `verify` | Review driver applications, open their documents, approve, request changes, reject, suspend and reinstate |
  | `configure` | Create and change service areas, schedule and cancel fare policy versions |

### Operator setup

1. The person signs in to the app (or web) once, so their Clerk user exists in `mobility.users`. Copy their Clerk user ID (`user_…`) from the Clerk Dashboard or the driver screen.
2. From your computer, with `DATABASE_URL` pointing at the right database:
   ```bash
   npm run admin -- grant-operator user_2abc... --name "Alex (support)" --permissions view,support,refund
   npm run admin -- operators                                   # list operators and their permissions
   npm run admin -- revoke-operator user_2abc... --reason "left the team"
   ```
   - Re-running `grant-operator` replaces that operator's permissions.
   - Revoking takes effect on the next request and unassigns their open support requests.
   - Grants and revocations are written to the audit log with actor `cli:<your OS user name>`.

### Local use

1. Apply migrations up to `005_operations_console.sql` to a **development** database (`npm run db:migrate`).
2. Run `npm run web` (or `npm start` and press **w**) and open `http://localhost:8081/admin`.
3. Sign in with an operator account. After sign-in you are returned to `/admin`.

Required environment variables (server side, never `EXPO_PUBLIC_`):

| Variable | Needed for |
| --- | --- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Signing in and verifying every admin request |
| `DATABASE_URL` | Operators, audit log, rides, support requests |
| `STRIPE_SECRET_KEY` (`sk_test_…`) | Creating and refreshing refunds. With no key, refunds are unavailable. With a live key, they are refused. |
| `STRIPE_WEBHOOK_SECRET` | Recommended: payment, refund and dispute webhooks (see the event list under [Deploying the API](#deploying-the-api)). Without it, the sweep and **Refresh from Stripe** are the only way to pick up refund status, Dashboard refunds and disputes |

The console never receives a Stripe secret, card details, client secrets, email addresses, phone numbers, or location history. Passenger accounts are shown masked (`user_…abcd`).

### What it shows

- **Review queue:** interrupted trips; settlements that are retrying or failing; authorizations that expired before capture or are expiring during a trip. Filter by category and date. An operator with `support` can mark an item reviewed, with a required note.
- **Support requests:** status, created and updated times, assigned operator, internal notes, and the resolution history. Filter by status, assignment, ride ID, and date. An operator assigns a request to themself, resolves it with a message the passenger sees, or reopens it with a reason.
- **Rides:** search by ride ID, payment state, and date. The ride page shows the transition log, matching attempts (driver name, outcome, and distance only), the payment ledger, notification outcomes, settlement state, linked support requests, refunds, and the operator audit for that ride.
- All lists use cursor pagination (20 per page, **Load more**).

### Test-mode refunds versus real money

What this version **can** do:
- Refund, **in Stripe test mode only**, money that Stripe reports as captured for a completed ride, up to the captured amount minus earlier and in-flight refunds. Full and partial refunds are supported.
- The server checks the key on every refund: if `STRIPE_SECRET_KEY` does not start with `sk_test_`, the request is refused with `503 LIVE_REFUNDS_DISABLED` and audited as denied. The console shows a warning banner in that case.

What it **cannot** do, and does not pretend to:
- Refund real money (live-mode keys are refused), release payouts to drivers, charge cancellation fees, charge for part of an interrupted trip, add tips, or adjust fares. Cancellation fees and partial-trip fares stay at zero.
- Refund an uncaptured hold. A hold that was never captured is **released**, which is not a refund.

How a refund runs:
1. The operator enters an amount in dollars and a reason (and optionally links a support request), then **Review refund**. The console shows the captured amount, previous refunds, refunds in progress, and the maximum refundable.
2. **Confirm refund** sends the request with a new idempotency key for that confirmation and the maximum the operator saw.
3. The server locks the ride and rejects the refund if:
   - the key was already used for a different refund (`IDEMPOTENCY_KEY_REUSED`);
   - the maximum changed since the screen loaded (`REFUNDABLE_CHANGED`, reload and review again);
   - the amount exceeds the maximum (`EXCEEDS_REFUNDABLE`);
   - another refund for the ride is still in progress (`REFUND_IN_PROGRESS`, one in flight per ride).
4. A double click or retry with the same key returns the existing refund (`duplicate: true`), never a second one.
5. The status shown (**pending**, **succeeded**, **failed**) comes from Stripe: the create response, webhooks, the sweep, or **Refresh from Stripe**. If Stripe can't be reached, the refund stays `creating` and the sweep re-submits it with the same Stripe idempotency key.

### Audit

`mobility.audit_log` records the verified operator, action, target, time, reason, and result (`succeeded`, `failed`, `denied`, `pending`) for every console action, including denied attempts and ride views. Details are filtered so they never contain tokens, secrets, card data, email, phone, or coordinates. Refund ledger entries use the actor `operator:<clerk user id>`. Refunds created by the old CLI keep their free-text operator name and are marked **legacy, unverified**.

Concurrent changes are safe:
- Support requests carry a version. A stale assign, resolve, or reopen gets `409 VERSION_CONFLICT`. Only the assigned operator can resolve, and a request assigned to someone else can't be taken (`ASSIGNED_TO_OTHER`).
- Review resolution is single-winner (`ALREADY_RESOLVED`).
- The console reloads after any conflict.

## Accounts, inbox, support and deletion

Status of every area, split into implemented, awaiting real-provider verification and blocked, is in [docs/implementation-checklist.md](docs/implementation-checklist.md). Deployment, backup, recovery, rate limits and retained records are in [docs/operations.md](docs/operations.md). The hands-on test plan is in [docs/manual-test-checklist.md](docs/manual-test-checklist.md).

### Profile and saved places

- Profile shows and edits the display name, email (verified by Clerk with a code to the new address), password and language.
- The name used on a ride is copied onto the ride when it is booked, so later renames don't rewrite history.
- Saved places: one Home, one Work, and up to 20 custom places per user. Each stores an address, coordinates and the provider's place ID.
- The server checks ownership on every read and write, validates coordinates and lengths, enforces the limits under concurrency, and treats a repeated submission with the same client ID as the same place.
- Saved places can be chosen as pickup or destination. A saved place outside every service area stays saved; the booking screen explains why it can't be used for this trip.
- Signing out or switching account clears places, inbox, quote and location state held on the device.

### Booking consistency

- The confirmation screen counts down the quote. When it expires, or the server answers `QUOTE_EXPIRED`, the request button is replaced by a notice that nothing was charged and a **Get a new price** button.
- After a refresh the screen says whether the price changed, with both amounts. A price never changes silently.
- Ride history is paginated (`GET /api/rides/history`), 20 at a time.
- Cancellation is confirmed inline with the consequence computed by the server, including that there is no cancellation fee.

### Notification inbox

- Every notification is stored for its recipient and listed in the app with read state, newest first, 20 at a time.
- Preferences switch **push alerts** per category (ride updates, chat, ride requests for drivers, account and support). An item muted for push still appears in the inbox.
- New kinds: driver application decisions, support replies and status changes, safety report status changes.
- Notification text is written in the recipient's language at the time it is created.
- The console shows counts for the review, support, safety and driver queues, limited to what the operator's permissions allow.

### Support

- A passenger opens a request from a receipt, then follows its status and conversation under **Help and support**.
- The passenger can reply while the request is open, within length and rate limits. Each participant sees only their own requests.
- An operator must assign the request to themself before replying. Replies notify the passenger. Internal notes are stored separately and are never returned by passenger routes.
- Resolving requires a closing message. Support never refunds; refunds are separate, permissioned operator actions.

### Account deletion

- Requires the password to be re-verified in the last 10 minutes (checked from the session token, not from the client's word).
- Refused with a reason while a ride is active, while online as a driver, while a payment is settling, or for an operator account.
- What is removed, what is retained, and the retry behaviour for the Clerk identity and Stripe customer are listed in [docs/operations.md](docs/operations.md#account-deletion-and-retained-records).
- **No retention period is implemented for retained records.** That is a legal decision for the service owner.

### Health, readiness and limits

- `GET /api/health` (liveness) and `GET /api/ready` (database, schema version, required configuration).
- The sweep takes a database lease, so overlapping schedulers don't run it twice.
- Per-user rate limits on saved places, profile writes, upload tickets, safety reports, support requests, share links and deletion attempts.
- The console's **System** page lists the configuration checklist (presence only, never values), job status and queue counters.

### Localization and accessibility

- All passenger and driver screens read their text from `lib/i18n` in English and Albanian. A test checks both languages have the same keys and placeholders.
- The server sends codes (ride status, payment state, cancellation variant, error code) and the app chooses the wording. Free text written by people (support replies, review notes) is shown as written.
- Money, dates and distances are formatted for the selected language.
- Buttons have a minimum height of 48 points, small controls at least 44, status changes are announced to screen readers, and error colours meet contrast on white. This has been checked in code only, not with a screen reader on a device.

## Requirements

- Node.js **20.12+** (22 LTS recommended) and npm
- PostgreSQL 14+: a free [Neon](https://neon.tech) database, Docker, or a local install
- A [Clerk](https://clerk.com) application (email + password enabled)
- A [Stripe](https://stripe.com) account in **test mode**
- Optional: a Google Maps Platform key (Places API + Directions API) and a Geoapify key

| Feature | Needs |
| --- | --- |
| Sign in, API access | Clerk publishable key + `CLERK_SECRET_KEY` |
| Quotes, rides, drivers | `DATABASE_URL` (migrated) |
| Requesting a ride | Stripe publishable + secret key |
| Webhook settlement | `STRIPE_WEBHOOK_SECRET` + Stripe CLI (local) or a public URL |
| Scheduled sweep (production) | `CRON_SECRET` + a scheduler |
| Address search, pre-booking route preview | `EXPO_PUBLIC_GOOGLE_API_KEY` |
| Quotes (required), driver ranking, routed ETA | `GOOGLE_ROUTES_API_KEY` (server-only). Without it, quotes answer `503 ROUTING_NOT_CONFIGURED`; the ETA uses a labelled estimate |
| Routing quota controls (optional) | `ROUTES_MAX_REQUESTS_PER_MINUTE` (default 120), `ROUTES_MAX_MATRIX_ELEMENTS_PER_MINUTE` (default 300) |
| Push notifications | Development build + EAS project ID + FCM (Android) or APNs (iOS); optional `EXPO_ACCESS_TOKEN` |
| Background location | Development build |
| Ride thumbnails | `EXPO_PUBLIC_GEOAPIFY_API_KEY` (otherwise a placeholder icon) |
| Operations console | `CLERK_SECRET_KEY` + `DATABASE_URL` + an operator granted with the CLI; refunds need a **test** `STRIPE_SECRET_KEY` |

## Setup

### 1. Install

```bash
git clone https://github.com/Orgitogj/Uber.git
cd Uber
npm install
```

### 2. Configure environment

```bash
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
```

Fill in `.env`. Only `EXPO_PUBLIC_*` values reach the app bundle. Keep secret keys unprefixed. Use test keys only.

### 3. Database

Pick one:

- **Neon (easiest on Windows):** create a project and paste its connection string (with `?sslmode=require`) as `DATABASE_URL`.
- **Docker:**
  ```bash
  docker run --name uber-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=uber -p 5432:5432 -d postgres:16
  ```
  Then use `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/uber`.
- **Local PostgreSQL:** create a database and point `DATABASE_URL` at it.

```bash
npm run db:setup     # = db:migrate (db/migrations/*.sql) + db:seed (db/seed.sql)
```

- Migrations are tracked in `public.mobility_schema_migrations` and applied once each.
- All tables live in the `mobility` schema, so older hand-made `public.*` tables are untouched.
- Migration `002` keeps rides from the old demo flow and marks them `legacy`.
- Migrations `013`–`017` add saved places and the language preference, the notification inbox and preferences, support conversations, account deletion, and rate limits with job status. They only add tables, columns and indexes.
- The seed only restores the four simulated demo drivers those legacy rides reference. It creates no users, drivers, rides, or payments.

### 4. Run

```bash
npm start            # Expo Go (dev server + API routes on port 8081)
```

`npm run start:dev-client` is available if you build a development client.

- **Android emulator (Windows):** install Android Studio, start a device from **Device Manager**, run `npm start`, and press **a**.
- **Physical device:** install Expo Go, join the same Wi-Fi as your computer, and scan the QR code. The app calls the API on the same host it loaded the JavaScript from.
  - If the bundle loads but API calls fail, allow **Node.js** through Windows Defender Firewall on private networks (TCP 8081).
  - Keep `EXPO_PUBLIC_SERVER_URL` empty in development.
- **iOS Simulator:** requires macOS with Xcode (press **i**). On Windows, use a physical iPhone with Expo Go.

## Testing the passenger and driver flows locally

You need **two signed-in accounts on two devices**: for example an Android emulator and a phone, or two phones. Each needs its own Clerk account with a different email.

1. **Create the driver account.** On device B, sign up, then tap **Drive with us** on Home. Save the application with any vehicle, colour and plate. The screen shows **Draft** and the account ID (`user_…`).
2. **Approve it.** With document storage configured, upload the four documents, submit, and approve in the console as described in [Driver verification](#driver-verification). Without a bucket, use the audited development override on your computer, with the same `DATABASE_URL`:
   ```bash
   npm run admin -- drivers                                                  # list applications
   npm run admin -- approve user_2abc... --waive-documents --reason "local testing"
   ```
   The app can only create and submit applications, and the API rejects any attempt to set status or role. To take access away, suspend the driver in the console (or `npm run admin -- suspend <ref> --reason "..."` when they have no active ride).
3. **Go online.** On device B the Drive screen now shows **Go online**. It explains why location is needed before the OS prompt; allow it. The **Location** card shows the sharing status and when the position was last sent. Keep the screen open, or turn on **Keep sharing in the background** in a development build.
4. **Request a ride.** On device A, pick a destination and tap **Find Now**. The confirm screen shows the price and "Drivers online nearby". Tap **Request ride** and pay with test card `4242 4242 4242 4242`.
   - This places a hold on the card. It is not a charge.
   - The pickup must be within 15 km of the driver's reported location. Emulators often report Mountain View, California; set the emulator's location, or pick a pickup near the driver.
5. **Accept.** Device B shows the request with a 20 s countdown; with push set up, it also gets a "New ride request" notification. Tap **Accept**. Device A switches to the assigned driver within about a second. Its map shows the driver's marker, the route to the pickup, and an **estimated** pickup time.
6. **Drive the trip.** Move device B, or change the emulator location: device A's marker follows and the ETA updates, without the map jumping. On device B, tap through **Start driving to pickup → I've arrived → Start trip → Complete trip**.
   - Device A follows each step. It gets notifications for accepted, arrived, trip started, and completed, and ends on a summary showing the charged amount.
   - After **Start trip**, the map switches to the route and estimated arrival at the destination.
   - The Stripe Dashboard shows the PaymentIntent captured.
7. **Try the edge cases.**
   - **Decline:** the ride moves to the next driver, or keeps searching.
   - **Let the offer expire:** after 20 s it moves on.
   - **Go offline while holding an offer:** the offer is withdrawn.
   - **Cancel while searching or after acceptance:** the hold is released, with no charge.
   - **No drivers online:** after 2 minutes the ride shows "No drivers were available" and the hold is released.
   - **Kill and reopen either app:** it resumes from the server state.
   - **Tap a notification from a killed app:** it opens the ride. Signed out, it asks you to sign in first, then opens the ride. A notification meant for another account on the device is ignored.
   - **Turn on airplane mode on the driver device:** the passenger sees "updated N min ago", then "location unavailable". The driver's Location card reports that updates aren't reaching the server.
   - **Deny location, or turn location services off:** the driver can't go online and sees a Settings button.
   - **Sign out and in as another account on the same phone:** the phone now only gets that account's notifications.
   - **Driver cancels before pickup** (with a third account online as a second driver): the passenger sees "Finding you another driver", the second driver gets the offer, and the Stripe Dashboard still shows one PaymentIntent with one hold.
   - **Driver taps End trip early during a trip:** the passenger sees "Trip ended early". The receipt shows "hold is being released", then "released, not charged" once Stripe confirms.
   - **Open a receipt from the Rides tab and tap Report a problem:** nothing changes on the charge. The receipt lists the report as **Received**. In the [operations console](#operations-console), open **Support**, assign it to yourself, and refund $1.00 from the ride page. The receipt shows the partial refund once Stripe reports it succeeded, and the reply once you resolve the request.

Stripe test cards:

| Card | Result |
| --- | --- |
| `4242 4242 4242 4242` | Hold placed |
| `4000 0025 0000 3155` | 3-D Secure, then hold placed |
| `4000 0000 0000 9995` | Declined: the ride stays unrequested and nothing is charged |

**Webhook (recommended):**

```bash
stripe login
stripe listen --forward-to localhost:8081/api/stripe/webhook
```

Copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET` and restart `npm start`. `stripe listen` forwards every event type by default. To limit it, pass the events from [Deploying the API](#deploying-the-api) with `--events`.

Test a Dashboard refund or dispute: refund a test payment in the Stripe Dashboard (test mode), or pay with a dispute test card such as `4000 0000 0000 0259`. The webhook imports it, and **Refresh from Stripe** on the console ride page does the same.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` / `npm run android` / `npm run ios` | Expo dev server (Expo Go) |
| `npm run db:migrate` / `db:seed` / `db:setup` | Apply migrations / seed / both |
| `npm run admin -- drivers \| approve <ref> --waive-documents --reason \| suspend <ref> --reason` | Development and recovery driver overrides, audited (needs `DATABASE_URL`) |
| `npm run admin -- operators \| grant-operator <clerkId> --name --permissions \| revoke-operator <clerkId> --reason` | Operator provisioning (see [Operations console](#operations-console)) |
| `npm run web` | Web build, including the operations console at `/admin` |
| `npm run build:admin` | Export the web build with the console and API routes to `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint + Prettier, zero warnings allowed |
| `npm test` | Jest (server + app projects), non-interactive |
| `npm run check` | All three, as CI runs them |

## Tests

`npm test` needs no accounts, keys, Docker, or network.

**Server tests** (`__tests__/server`) run the real route handlers against PostgreSQL:
- The database is an in-process PGlite server, using the real migrations and the real `pg` driver.
- Session tokens are real RS256 JWTs verified by Clerk's `verifyToken`.
- Stripe is replaced by an in-memory fake that supports manual capture, and can simulate outages.
- Webhook signatures use the real Stripe library.
- Every scenario ends with database invariant checks:
  - No ride is `paid` unless it's completed.
  - No active ride is missing its card hold.
  - No ended ride keeps a hold.
  - Each ride has at most one accepted offer, and it matches the assigned driver.

Coverage by area:
- **Roles.** Authentication on every route; passenger vs pending, approved, or suspended driver; operator-only approval; ownership (404 for other users).
- **Driver verification.**
  - Applicant: draft → submit only when vehicle and all documents are present; locked while submitted; strict input so no self-approval; expiry required; the storage key never reaches the applicant.
  - Files: wrong type, oversized (also in PUT mode), disguised content (signature mismatch), size mismatch, and missing uploads are rejected, and the upload is removed. Replacing a file keeps the old one only for its retention. Missing configuration returns 503.
  - Upload hardening (`document-storage.test.ts`):
    - Re-using an upload link after confirmation doesn't change the reviewed file; an upload link reused after a rejection leaves nothing behind.
    - A file changed between the size check and the content check, or between the check and the copy, is refused, and a clean retry works.
    - A replacement or an abandoned-upload cleanup that runs during confirmation wins without leaving a live row pointing at a missing file. A deletion job that consumes the reservation makes confirmation fail.
    - The worker never deletes a live file. Deletions are retried after storage outages. A reopened application racing cleanup keeps a consistent state.
    - Old view links stop working once a replaced file is purged, and no new ones are issued.
    - The POST policy pins key, type and exact size. PUT is only used when configured. Copy and read requests carry signed ETag preconditions, and an error inside a `200` copy response is detected.
  - Operators: only `verify` may list, view, open files or decide, and denials are audited. File links last 60 s and are audited. Access to another driver's file returns 404 for both operators and drivers. Operators can't review their own application. Of two concurrent decisions, exactly one wins. A refused approval saves none of its document choices.
  - Eligibility: an expired document ends approval, blocks going online, offers and location, and the sweep takes the driver offline. Suspension before pickup re-matches the passenger, notifies them and flags the ride. Suspension during a trip lets it finish and flags it.
  - Passenger view contains only the name, vehicle, colour, plate and seats. The CLI can approve only with an audited waiver and won't suspend mid-ride. The SigV4 signer matches AWS's published example.
- **Matching.** Each eligibility rule, deterministic order, offer expiry, decline, going offline, drivers coming online mid-search, the no-driver timeout, and the sweep.
- **Lifecycle.** The full trip, skipped and backward transitions, duplicate taps, and cancellation rules.
- **Concurrency.** Parallel accepts, accept racing cancel, one pending offer per driver, and one capture under a double completion.
- **Payments.** Hold-then-capture, declines and retries, deferred capture and release after Stripe outages, abandoned checkouts, amount mismatches, webhook signatures, replays, and stale events.
- **Location.** Only the driver can update their own position, and only while sharing is allowed. Tests cover the validation rules (range, stale, future, accuracy, jump, order, throttle), that only the assigned passenger can see the position during the ride, live/recent/unavailable freshness, and that the position is wiped when the driver goes offline.
- **Service areas and road-based quotes** (`service-areas.test.ts`, `quotes.test.ts`):
  - Geometry: concave boundaries, edges, points just outside, and invalid boundaries.
  - Coverage: pickups and destinations outside coverage (refused before routing), drop-off rules, inactive and missing areas, overlapping areas.
  - Policies: a policy not yet in effect.
  - Routing failures: no route, provider outage without any straight-line fallback, missing key, the per-minute budget.
  - Quotes: reuse of identical quotes, the per-passenger limit, expiry, duplicate bookings.
  - Changes over time: bookings refused after deactivation while running rides finish, scheduled policies never repricing earlier quotes or rides, effective-date and cancellation rules, concurrent policy versions and concurrent area edits, a shrunken area.
  - Operators: permissions, with audited refusals.
  - Rounding.
- **Road-based matching** (`road-matching.test.ts`):
  - Road time beats straight-line distance, and unreachable drivers are never offered the ride, while the search still ends on time.
  - Provider outage and budget exhaustion fall back to straight-line order with backoff.
  - Snapshot reuse and refresh, at most 10 matrix origins, and single-flight refresh under concurrency.
  - A ranked driver who goes offline is never offered the ride, and matching works without a provider.
- **Routing provider** (`routing-provider.test.ts`): request shape and field masks, no-route, HTTP errors, timeouts, invalid bodies, matrix element parsing, the 10-origin cap, and the shared per-minute budget.
- **ETA.** Routed and estimate sources, no routing call per location update, the refresh rules, fallback on errors and without a key, the fare never changing, leg switching, one provider call for concurrent watchers, and sending the route only when it changes.
- **Watch.** Immediate answer to stale cursors, timeouts with no change, waking on the other party's action or a new position, recovering missed changes after a reconnect, and the wait limit.
- **Re-matching and cancellation.**
  - Driver cancellation from each pre-pickup state keeps the same ride and hold, with no new PaymentIntent.
  - Drivers who cancelled or declined are excluded; the old driver's location and ride access are removed at once; a replacement completes the trip with one capture.
  - Re-match deadline and limit, offer expiry during a re-match, driver cancel racing passenger cancel, and a stale accept from the old driver racing the new one.
  - Interruption rules and payment, passenger cancellation from every state, and the server-computed previews.
- **Settlement and receipts.**
  - A release failure shows "being released" (never "not charged") until Stripe confirms. Backoff is respected, and a ride is flagged after repeated failures.
  - No capture of a hold Stripe has expired, but capture still happens when our estimate has passed and Stripe says the hold is valid. Searches whose hold is expiring are ended; active trips are flagged. Stripe's `capture_before` is recorded.
  - Receipt ownership and contents, legacy receipts, and driver trips without payment data.
  - Support requests never refund.
- **Operations console.**
  - Provisioning: only the CLI grants or revokes the role; unknown users and permissions are rejected; a passenger can't make themself an operator through any API; revocation is immediate.
  - Access: unauthenticated, non-operator, and missing-permission requests are refused, and denials are audited with the verified identity; each permission is enforced separately.
  - Support: passengers see only their own requests and never internal notes; assignment rules; concurrent assign and resolve with one winner and `VERSION_CONFLICT` for the other; reopen.
  - Review: single-winner resolution; ride details without tokens, coordinates, or full account IDs.
  - Refunds: refund permission required; idempotent double submit; stale maximum; over-refund; concurrent refunds on one ride; Stripe outage then sweep re-submit; failed and pending-then-succeeded refunds; the live-key guard.
  - Audit: every action carries the verified operator identity, and details never contain secrets or personal data.
  - Pagination and filters.
- **Safety.**
  - Reports by the passenger, the current driver and a former driver after a rematch; strangers get 404.
  - Reports stay private from the other participant; validation; idempotent retries.
  - The 7-day window after completion and after a driver leaves; reports on cancelled rides.
  - Message reports need visibility: a new driver can't report the previous driver's messages, and nobody can report their own.
  - Operators see only the reported snapshot. Evidence survives the chat purge and is redacted 180 days after closure.
  - Triage permissions and audit, concurrent assignment, version conflicts, required notes, reopening.
  - Trip links: only the passenger creates them; tokens are stored hashed; no payment, chat or ride ID in the response.
  - Links: revoked, expired, capped at 3, location dropped after the trip, ended 30 minutes later, and following a rematch and a cancellation.
- **Refunds and disputes.**
  - Operator tip refunds: full and partial, idempotent, capped, stale maximum, pending then succeeded, declined, and a Stripe outage with re-submission.
  - Permissions, non-operators and the live-key guard, all audited; concurrent refunds.
  - Dashboard fare and tip refunds imported once, pending not counted, out-of-order events, a reversed refund flagged, and **Refresh from Stripe**.
  - Disputes created, funds withdrawn and reinstated (won) or kept (lost).
  - Replayed, concurrent and out-of-order dispute events; tip disputes blocking tip refunds.
  - Flagged cases: a dispute after a refund, and a dispute on an unknown payment.
- **Earnings and tips.**
  - Earnings are written only after Stripe confirms a capture: pending captures stay out, and cancelled and interrupted rides never earn.
  - Webhook replays write nothing twice.
  - Commission versioning with a later policy leaves earlier rides untouched; splits and cumulative refunds are exact in integer cents.
  - Partial and full refunds become proportional adjustments; pending refunds wait for Stripe.
  - Ownership and no passenger payment data in driver responses; pagination and period filters.
  - Tip consent and amount limits; tips only on completed, paid, real rides; declined and 3-D Secure states; duplicate and concurrent requests; changed amounts; cancellation.
  - Recovery after the app closes, confirmation from the webhook alone, and tip refunds made in Stripe.
  - Abandoned tips are cancelled, and a deleted ledger entry is detected and repaired.
- **Chat.** Membership and assignment checks, a replaced driver losing access at once, a new driver not seeing earlier messages, read-only after the ride ends and expiry after retention (with the sweep purging rows), validation, stable ordering and pagination in both directions, watch wake-ups and unread counts, duplicate and concurrent sends, burst and per-ride limits with `Retry-After`, and collapsed notifications that don't contain message text.
- **Ratings.** Eligibility (completed and paid only; cancelled, interrupted, unpaid, simulated and expired refused), no self-rating or rating someone else's ride, scale and length validation, one record under concurrent submissions, the edit window, averages hidden below 3 final ratings, private feedback never reaching the other party, and moderation with permissions, version conflicts, removal from averages and audit entries without feedback text.
- **Profile and saved places** (`profile-places.test.ts`): ownership (404 for another user's place), validation, the Home/Work replacement rule, one Home and one Work under concurrent requests, the custom limit, idempotent retries, the name snapshot on rides, the language preference, and service-area rules still applying to a saved place.
- **Inbox and support** (`inbox-support.test.ts`): inbox ownership, pagination, read state, push muted by preference while the inbox keeps the item, text in the recipient's language, application and safety status notices that don't expose the reason or contents; support conversations scoped to their owner, internal notes never returned to the passenger, reply limits, and queue badges limited by permission.
- **Account deletion** (`account-deletion.test.ts`): re-authentication from the token and the exact confirmation, blockers, anonymisation, retained ride and payment rows, a deleted identity refused afterwards, retry after identity or payment provider failures, the pending state when identity deletion isn't configured, drivers taken off the road with documents scheduled for removal, and share links revoked.
- **Operations** (`operations.test.ts`): rate-limit windows and `Retry-After`, health and readiness, configuration rules for development and production, the configuration checklist never returning values, the sweep lease under concurrent calls, throttled heartbeat maintenance, failing steps recorded for operators, the system status permission, and ride history paging.
- **Notifications.** Recipients per event, no push for GPS, deduplication under duplicate taps and concurrent deliverers, outage retry, expired offers, users without devices, `DeviceNotRegistered` from tickets and receipts, account switching, and sign-out.

**App tests** (`__tests__/app`) cover:
- Trip validation.
- API error mapping.
- The watch source: it sends its latest cursors after a reconnect, ignores stale versions, falls back to polling, stops at final states, and pauses and resumes.
- Polyline decoding.
- Notification and deep-link routing: only allowlisted routes, the matching recipient, the sign-in redirect, and rejecting malformed payloads.
- Status and payment wording.
- Console helpers: dollar-to-cents parsing for refunds, date filters as UTC day bounds, query building, and the sign-in return to `/admin`.
- Earnings: period ranges, commission rate formatting, and tip state wording that never calls an unpaid tip paid.
- Localization (`i18n.test.ts`): identical keys and placeholders in English and Albanian, plural pairs, error codes mapped without leaking English into Albanian, money and distance formatting, ride, payment and cancellation wording in both languages, quote-expiry countdown, trip problem codes, and the inbox, support and safety notification routes.
- Chat: optimistic messages reconciled with server copies without duplicates, retries keeping their ID, out-of-order pages merged by sequence, the chat cursor never moving backwards, chat deep links opening only after server authorization, and rating summary wording.

PGlite runs every connection on one backend session, so locally the tests use one connection. Requests still interleave at every query and transaction boundary. The CI job `postgres` reruns the server tests on PostgreSQL 16 with four connections, so concurrency tests also contend on real row locks. To run that locally against a disposable database:

```bash
TEST_DATABASE_URL=postgresql://... TEST_DATABASE_ALLOW_RESET=1 TEST_DB_POOL_MAX=4 npx jest --selectProjects server --runInBand
```

`TEST_DATABASE_ALLOW_RESET=1` is required because the run **drops the `mobility` schema** in that database.

## API

| Route | Who | Purpose |
| --- | --- | --- |
| `POST /api/quotes` | signed in | Check the service area, get the road route, price it with the area's fare policy; reuses an identical quote from the last minute |
| `GET /api/admin/service-areas`, `POST /api/admin/service-areas` | operator (configure) | List areas; create an inactive area (boundary, drop-off rule, reason) |
| `GET /api/admin/service-areas/:id`, `PATCH /api/admin/service-areas/:id` | operator (configure) | Area with policies and history; rename, move the boundary, change the drop-off rule, activate or deactivate (version and reason required) |
| `POST /api/admin/service-areas/:id/policies`, `POST /api/admin/service-areas/:id/policies/:policyId/cancel` | operator (configure) | Schedule a new fare policy version with an effective date; cancel a version that hasn't started |
| `POST /api/rides` | passenger | Create a ride from a quote + PaymentSheet secrets (idempotent per quote) |
| `POST /api/rides/:id/refresh` | passenger | Record the PaymentIntent state from Stripe; starts the search |
| `GET /api/rides`, `GET /api/rides/active` | passenger | History; current ride (restart recovery) |
| `GET /api/rides/:id` | passenger or assigned driver | Ride view with server-computed `allowedActions` |
| `GET /api/rides/:id/watch` | passenger or assigned driver | Long poll: ride changes + latest driver location, ETA, route |
| `POST /api/rides/:id/interrupt` | assigned driver | End an in-progress trip early (reason required); no charge |
| `GET /api/receipts`, `GET /api/receipts/:id` | passenger (own rides) | Receipts derived from server and Stripe records |
| `POST /api/rides/:id/support` | passenger (own ride) | Open a support request (never a refund) |
| `GET /api/rides/:id/support` | passenger (own ride) | Own support requests: status, times, resolution reply (no internal notes) |
| `GET /api/rides/:id/tip`, `POST /api/rides/:id/tip` | passenger (own completed ride) | Tip state; start or resume a tip (`amountCents`, `idempotencyKey`, `consent: true`) and get payment-sheet secrets |
| `POST /api/rides/:id/tip/refresh`, `/tip/cancel` | passenger | Record the tip's Stripe status; cancel an unpaid tip |
| `GET /api/driver/earnings/summary`, `GET /api/driver/earnings`, `GET /api/driver/earnings/:rideId` | driver (own) | Period totals and pending amounts; paginated rides with breakdowns; one ride |
| `GET /api/rides/:id/safety` | passenger, current or former driver | Safety screen data: ride status, details for the viewer's role, own reports, the passenger's share links |
| `POST /api/rides/:id/safety-reports` | passenger, current or former driver | Submit a safety report (category, description, client report ID) |
| `GET /api/safety-reports/:id` | reporter only | Own report status |
| `POST /api/rides/:id/messages/:messageId/report` | passenger or current driver | Report a received chat message; stores an evidence snapshot |
| `POST /api/rides/:id/shares`, `POST /api/shares/:id/revoke` | passenger | Create or revoke a trip share link |
| `GET /api/share/:token` | anyone with the link | Minimal shared trip status (no session) |
| `GET /api/admin/safety`, `GET /api/admin/safety/:id`, `POST /api/admin/safety/:id/triage` | operator (support) | Safety queue, case view, triage actions |
| `GET /api/rides/:id/chat` | passenger or current driver | Chat state and unread count (used to authorize notification taps) |
| `GET /api/rides/:id/messages`, `POST /api/rides/:id/messages` | passenger or current driver | Page messages (`before`/`after`/`limit`); send with a client UUID (idempotent, rate-limited) |
| `POST /api/rides/:id/messages/read` | passenger or current driver | Advance the read position |
| `GET /api/rides/:id/rating`, `POST /api/rides/:id/rating` | passenger or final driver | Rating state; submit or edit within the window |
| `GET /api/admin/feedback`, `POST /api/admin/feedback/:id/moderate` | operator (view / support) | Feedback queue; review, remove or restore a rating |
| `GET /api/admin/me` | operator | Verified operator identity, permissions, Stripe mode |
| `GET /api/admin/review` | operator (view) | Review queue (category, date, cursor) |
| `POST /api/admin/rides/:id/review` | operator (support) | Mark a review item resolved (note required) |
| `GET /api/admin/rides`, `GET /api/admin/rides/:id` | operator (view) | Ride search; ride details |
| `POST /api/admin/rides/:id/refunds` | operator (refund) | Test-mode refund (idempotency key, expected maximum) |
| `POST /api/admin/refunds/:id/sync` | operator (refund) | Refresh a refund's status from Stripe |
| `POST /api/admin/tips/:id/refunds` | operator (refund) | Test-mode tip refund, full or partial (idempotency key, expected maximum, reason) |
| `POST /api/admin/tip-refunds/:id/sync` | operator (refund) | Refresh a tip refund's status from Stripe |
| `POST /api/admin/rides/:id/stripe-sync` | operator (support) | Import refunds and disputes for the ride's fare and tip from Stripe |
| `GET /api/admin/support`, `GET /api/admin/support/:id` | operator (view) | Support queue; request with notes and history |
| `POST /api/admin/support/:id/assign`, `/notes`, `/resolve`, `/reopen` | operator (support) | Support actions, versioned |
| `GET /api/driver/trips` | approved driver (own) | Completed trips without payment details |
| `POST /api/rides/:id/cancel` | passenger or assigned driver | Passenger: cancel and release the hold. Driver: re-match (or end after the limit) |
| `POST /api/rides/:id/status` | assigned driver | `arriving` → `arrived` → `in_progress` → `completed` |
| `GET/POST /api/driver/profile` | signed in | Read / create or edit a draft driver application (vehicle details) |
| `POST /api/driver/profile/submit`, `/reopen` | driver (own) | Submit for review; start an update after approval or rejection |
| `POST /api/driver/documents` | driver (own, editable) | Get a 5-minute presigned POST form (or PUT) for one document's upload key |
| `POST /api/driver/documents/:id/complete` | driver (own document) | Check the upload's size, type and signature, then copy it to a key no client can write |
| `GET /api/admin/drivers`, `GET /api/admin/drivers/:id` | operator (verify) | Application queue; application with documents and history |
| `POST /api/admin/drivers/:id/documents/:documentId/access` | operator (verify) | 60-second view link for one file (audited) |
| `POST /api/admin/drivers/:id/decision` | operator (verify) | Approve, request changes, reject, suspend or reinstate (reason, version, per-document decisions) |
| `POST /api/driver/availability` | approved driver | Go online (with location) / offline |
| `POST /api/driver/heartbeat` | driver | Keep-alive; returns offer + active ride |
| `POST /api/driver/location` | approved driver, or any driver finishing an active ride | Latest device position, validated |
| `POST /api/devices`, `/api/devices/unregister` | signed in | Register / remove this device's Expo push token |
| `POST /api/driver/offers/:id/accept`, `/decline` | driver holding the offer | Respond to an offer |
| `GET /api/me`, `PATCH /api/me` | signed in | Profile (name, language); update either |
| `GET /api/places`, `POST /api/places` | signed in (own) | Saved places with the remaining custom allowance; save or replace Home/Work, add a custom place |
| `PATCH /api/places/:id`, `DELETE /api/places/:id` | signed in (own) | Rename or move a place; delete it |
| `GET /api/rides/history` | passenger | Paginated ride history (`cursor`, `limit`) |
| `GET /api/notifications`, `POST /api/notifications/read` | signed in (own) | Inbox page with unread count; mark some or all read |
| `GET /api/notifications/preferences`, `PUT /api/notifications/preferences` | signed in (own) | Push preferences per category |
| `GET /api/support`, `GET /api/support/:id`, `POST /api/support/:id/messages` | passenger (own requests) | Requests with unread state; one conversation; reply while open |
| `GET /api/admin/support/:id/messages`, `POST /api/admin/support/:id/messages` | operator (view / support, assignee) | Conversation; reply to the passenger |
| `GET /api/admin/badges` | operator (view) | Queue counts allowed by the operator's permissions |
| `GET /api/admin/system` | operator (view) | Configuration checklist, job status, queue counters |
| `GET /api/account/deletion`, `POST /api/account/deletion` | signed in | Blockers and whether re-authentication is needed; delete the account (`confirm: "DELETE"`) |
| `GET /api/health`, `GET /api/ready` | anyone | Liveness; readiness (database, schema, required configuration) |
| `POST /api/stripe/webhook` | Stripe (signed) | Payment events |
| `POST /api/internal/sweep` | scheduler (`CRON_SECRET`) | Advance due searches, retry settlements |

## Deploying the API

1. Run `npm run build:admin` (`npx expo export --platform web`). This writes `dist/client` and `dist/server` (the API routes). The web build includes the operations console at `/admin` and shows placeholders for maps and payments in the passenger screens.
2. Host `dist/` on [EAS Hosting](https://docs.expo.dev/eas/hosting/introduction/) or any Node server using `expo-server` ([docs](https://docs.expo.dev/router/web/api-routes/)). Set the server-only env vars there.
3. Run `npm run db:setup` against the production database.
4. Set `EXPO_PUBLIC_SERVER_URL=https://<your-host>` for app builds.
5. Register the Stripe webhook `https://<your-host>/api/stripe/webhook` with exactly these events:
   `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`, `payment_intent.processing`, `payment_intent.payment_failed`, `payment_intent.requires_action`, `payment_intent.canceled`, `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded`, `charge.refund.updated`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`.
   - Signatures are verified with `STRIPE_WEBHOOK_SECRET`, and event IDs are stored to ignore replays.
   - Every handler re-fetches the PaymentIntent, refund or dispute from Stripe instead of trusting the event body, so out-of-order delivery is harmless.
   - The sweep in step 6 is the recovery path if events are missed.
6. Schedule `POST https://<your-host>/api/internal/sweep` with `Authorization: Bearer $CRON_SECRET` every minute. It also retries notifications, checks push receipts, deletes due documents and finishes account deletions. A database lease stops two schedulers from overlapping.
7. Set `GOOGLE_ROUTES_API_KEY`, a server key restricted to the Routes API (and by IP where your host allows). Quotes need it. Then create a service area and fare policy in the console (see [Service areas and road-based quotes](#service-areas-and-road-based-quotes)); nothing can be quoted until you do. Set `EXPO_ACCESS_TOKEN` if you enable enhanced push security.
8. For driver documents, create a private S3-compatible bucket and set the `DOCUMENT_STORAGE_*` variables (see [Private storage](#private-storage)). Without them, driver applications can't upload documents and approval is only possible through the CLI waiver.
9. Point liveness checks at `GET /api/health` and readiness checks at `GET /api/ready`, then open the console's **System** page and clear every missing setting. Backup and recovery are described in [docs/operations.md](docs/operations.md).
10. Make sure your host allows requests of at least **25 s**, which the long-poll `watch` route needs. If it doesn't, the app falls back to 3 s polling automatically.

## Project structure

```
app/                 screens (Expo Router); app/api/* thin route files
  (root)/ride/[id]   live ride screen shared by passenger and driver
  (root)/driver      driver application, availability, offers
  admin/             operations console routes; the screens live in components/admin/console and are
                     loaded only when process.env.EXPO_OS is "web", so they are not in the Android/iOS bundle
  (root)/chat/[id]   ride conversation
  (root)/earnings    driver earnings
  (root)/safety/[id] safety screen
  share/[token]      public trip-share page
  (root)/places, notifications, support, delete-account   saved places, inbox, support conversations, account deletion
server/              auth, db, pricing, lifecycle (state machine), matching, rides (payments ↔ rides),
                     location (validation), live + routing (ETA), notifications (outbox), routes
shared/              request/response contracts, money formatting, geo validation
lib/i18n/            dictionaries (English, Albanian), formatting, language store
components/ lib/ store/   UI, API client, live updates (lib/rideUpdates.ts), driver heartbeat (lib/driver.ts),
                     location tracking (lib/tracking.ts), push + deep links (lib/notifications*.ts)
db/migrations, db/seed.sql, scripts/   schema, seed, db and operator CLIs
__tests__/, jest/    tests and the PostgreSQL test database
```

## Known limitations and next phases

- **Driver verification.**
  - People review the documents; there is no automated identity, liveness, licence or insurance check, and no integration with any registry.
  - No malware scanning of uploaded files beyond type, size and signature checks.
  - Deletion on request is manual (see [Retention and deletion](#retention-and-deletion)).
  - Uploads against a real bucket have not been exercised in automated tests; they use an in-memory store that accepts anything. What the bucket enforces (POST policy conditions, signed PUT headers, ETag preconditions on read and copy) must be checked with the [manual test](#manual-test) on each provider you use.
  - In PUT mode (needed for Cloudflare R2), the bucket doesn't cap upload size; an oversized upload is stored until confirmation fails or the upload key expires.
  - A 60-second view link can't be revoked early.

- **Realtime.** Long polling costs about one database query per second per waiting client. At scale, use pub/sub (for example Redis, or a managed realtime service) behind `RideUpdateSource`.
- **Location.**
  - Background tracking depends on the OS and a live Clerk session in the app process. It stops if the app is force-quit.
  - There is no position history or smoothing, and no map-matching.
- **ETA.** Traffic-unaware routing. No ETA to pickup for a driver without a recent position.
- **Earnings and tips.**
  - No payouts, transfers, Stripe Connect or driver onboarding: earnings are a record, not money moved.
  - The only commission policy is the 0% development default until you add a rate.
  - Refunds from the console only run in Stripe test mode.
  - Disputes are answered in the Stripe Dashboard; the app doesn't submit evidence.
  - Dispute fees aren't charged to drivers.
  - A refund that Stripe reverses after success is flagged but not reversed in the ledger.
  - Refunds and disputes on payments that were never captured, or that match no ride or tip, are flagged rather than applied.
  - The sweep doesn't scan Stripe for new Dashboard refunds or disputes: they arrive by webhook or through **Refresh from Stripe**.
- **Safety.**
  - No emergency-services integration, in-app calling or phone-number masking.
  - Reports and triage don't notify anyone in real time; operators check the queue.
  - The public share page shows a text position with a Maps link, not an embedded map.
  - In development, share links point at the development server's LAN address; set `EXPO_PUBLIC_SERVER_URL` for links that work outside your network.
- **Chat and ratings.**
  - Text only: no photos, voice or calls, and no masked phone numbers.
  - Unsent messages are kept in memory, not on disk, so a failed message is lost if the app is closed before retrying.
  - Operators can't read chat; they see only a message a participant reported.
  - Rating averages are computed on each request, with no caching or decay.
- **Notifications.** Delivery is at-least-once: a send that crashes mid-flight can repeat once after 60 s. Preferences are per category with no quiet hours, and there are no Live Activities or ongoing notifications. Inbox items are kept until the account is deleted; there is no automatic expiry.
- **Matching.** One offer at a time; at most 2 re-matches with a 120 s deadline each.
- **Payments.**
  - Not built, and each needs a separate decision: cancellation fees, surge pricing, fare adjustments, driver payouts, another currency, re-authorization of long trips, and live-mode refunds (the console is test-mode only).
  - An interrupted trip is never charged, even if most of it was driven; support can review it, but charging part of the fare is not implemented.
- **Operations.**
  - Operators are provisioned from the CLI only; there is no invitation flow, SSO, or MFA requirement beyond what Clerk enforces.
  - Support conversations are text only, opened by passengers from a receipt; drivers have safety reports but no support requests.
  - The console is English only.
  - The console is a web page in the same build; it has no separate hosting or IP restriction.
- **Account deletion.** No retention period is set for retained financial, safety and audit records, and backups are outside the application's control. Deletion of the Clerk identity and Stripe customer has only been tested against stand-ins.
- **Localization.** Albanian text was written during implementation and not reviewed by a translator. Text written by people (support replies, review notes) and Stripe's own payment-sheet messages are not translated by the app.
- **Not planned without a decision.** Scheduled rides, multiple stops, pooled rides, vehicle classes, emergency dispatch, phone masking, in-app calling, automated identity verification, and country-specific transport or insurance rules. See [docs/implementation-checklist.md](docs/implementation-checklist.md#features-requiring-a-separate-decision).
- **Web.** Web is limited to building the API server; maps and payments are native-only.
