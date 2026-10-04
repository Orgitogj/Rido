# Manual test setup

How to get from the current development configuration to a first two-device ride, and the order to test in afterwards. The detailed checks are in [manual-test-checklist.md](manual-test-checklist.md); this page is the setup and the order.

Nothing on this page was executed during implementation. Every step needs your credentials or your devices.

## Configuration state (checked 2026-10-03, values not read out)

| Area | Setting | State |
| --- | --- | --- |
| Database | `DATABASE_URL` | Present. Points at Neon, the shared remote database. Migrations 013–024 have not been applied there |
| Clerk | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Present, development instance |
| Clerk | `CLERK_SECRET_KEY` or `CLERK_JWT_KEY` | **Missing.** The server cannot verify any session without one of them |
| Payments | `PAYMENT_MODE`, `APP_CURRENCY` | Missing, so the defaults apply: paid in the vehicle, in lek. Nothing to add |
| Stripe | `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY` | Present, test mode. Not used in the default payment mode |
| Stripe | `STRIPE_WEBHOOK_SECRET` | Missing. Not used in the default payment mode |
| Google Routes | `GOOGLE_ROUTES_API_KEY` | **Missing.** No quote can be priced without it |
| Google Places | `EXPO_PUBLIC_GOOGLE_API_KEY` | Present |
| Storage | `DOCUMENT_STORAGE_*` | Missing. Driver documents and support attachments answer 503; drivers can only be approved with the CLI waiver |
| Expo push | EAS project ID (`EXPO_PUBLIC_EAS_PROJECT_ID` or `app.json`), `eas.json`, Android `google-services.json` | Missing. No push token can be issued; the in-app inbox still works |
| API URL | `EXPO_PUBLIC_SERVER_URL` | Present, an `http` address on the local network. Phones must be on the same Wi-Fi as the computer |
| Scheduler | `CRON_SECRET` | **Missing.** The sweep endpoint refuses every call |
| Trip PIN | `RIDE_PIN_SECRET` | **Missing.** In development no PIN is issued without it |
| Scheduling | `SCHEDULED_RIDE_MIN_LEAD_MINUTES`, `SCHEDULED_RIDE_MAX_DAYS` | Missing. Optional; defaults are 30 minutes and 7 days |

No server secret is stored under an `EXPO_PUBLIC_` name, and `.env` is ignored by git.

## 1. Settings to add to `.env`

Required before the first ride:

1. `DATABASE_URL`: a database you are willing to migrate. Either a new local database (PostgreSQL 18 is installed and running on this computer on port 5432), or keep Neon and accept that step 2 applies migrations 013–024 to it.
2. `CLERK_SECRET_KEY`: from the Clerk dashboard of the same development instance as the publishable key.
3. `GOOGLE_ROUTES_API_KEY`: a server key restricted to the Routes API. Each quote, ETA refresh and matching comparison is a billable request.
4. `CRON_SECRET` and `RIDE_PIN_SECRET`: two different random values. Generate each with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

Needed later, for the sections named:

- `DOCUMENT_STORAGE_*` (a private S3-compatible bucket): driver document review and support attachments.
- An EAS project ID, `eas.json`, a development build and, on Android, `google-services.json`: push notifications and background location.
- `STRIPE_WEBHOOK_SECRET` with `stripe listen --forward-to http://localhost:8081/api/stripe/webhook`: webhook delivery, refunds and disputes arriving from Stripe.

## 2. Database

```bash
npm run db:setup
```

This applies every migration and the seed to the database in `DATABASE_URL`. Check which database that is before running it. The seed adds a development example area in San Francisco and a development example category; neither is needed for the test.

## 3. Start the server and the app

```bash
npm start
```

- Phones: open the project in Expo Go on two phones on the same Wi-Fi. Expo Go is enough for the first ride. It cannot do background location, and on Android it cannot receive push.
- Console: open `http://localhost:8081/admin` in a desktop browser.
- Check `http://localhost:8081/api/ready` answers `200`. If it answers `503`, the response says which of database, schema or configuration failed.
- Run the sweep once a minute in a second terminal while testing (PowerShell):

  ```powershell
  while ($true) { curl.exe -s -X POST http://localhost:8081/api/internal/sweep -H "Authorization: Bearer <CRON_SECRET>"; Start-Sleep 60 }
  ```

## 4. Accounts, in this order

1. **Operator.** Sign up in the app or the browser with the account you will use for the console, so the server knows the user. Copy its Clerk user ID (`user_...`) from the Clerk dashboard. Then:

   ```bash
   npm run admin -- grant-operator <clerkUserId> --name "Your name" --permissions view,support,refund,verify,configure
   ```

   Open `/admin` and check **System** shows no "Missing" line that you did not expect.
2. **Service area.** Console → **Service areas** → **New service area**. Draw a boundary around where the phones are (one `latitude, longitude` per line, in order around the edge), choose "Development area", give a reason, create. Open it and set the **time zone** to your local IANA zone (for example `Europe/Tirane`).
3. **Vehicle category.** Console → **Vehicle categories**. The **Standard** category exists after the migration and is enough for the first ride. For the category tests, create a second one with a higher capacity and mark it as a development example.
4. **Development fare policy.** On the area's page → **Schedule a new fare policy**: category **Standard**, "Development placeholder rates", any small amounts, effective from `now`, a reason. Then **Activate** the area. Repeat the policy for the second category when you need it.
5. **Driver.** On phone B, sign up as a second user, tap **Drive with us**, enter the vehicle details and save.
   - With storage configured: upload the documents, submit, then approve in the console under **Drivers**, selecting the category.
   - Without storage: approve with the audited waiver.

     ```bash
     npm run admin -- drivers
     npm run admin -- approve <ref> --waive-documents --categories general --reason "Manual test driver"
     ```
6. **Passenger.** On phone A, sign up as a third user. No card is needed: the passenger pays the driver at the end of the trip.

## 5. Test order

Run these in order. Stop and fix at the first failure; later sections assume the earlier ones work.

| Order | What | Checklist section | Needs beyond the first-ride setup |
| --- | --- | --- | --- |
| 1 | One ordinary ride: driver online, passenger requests the Standard category with one passenger and no stops (no card is asked for), accept, pickup, enter the PIN once correctly, complete, then the driver records the payment as terminal or cash; the receipt shows it and the driver's Earnings screen shows the balance | 3, 4, 18 | Nothing |
| 2 | Trip PIN failures: wrong PIN, lock, block, operator waiver, new PIN after a re-match | 13 | Nothing |
| 3 | Stops: two stops, order, progress, receipt | 16 | Nothing |
| 4 | Vehicle categories and passenger count | 15 | The second category with a fare policy |
| 5 | Scheduled request: schedule, confirm, expiry, cancel | 17 | The sweep loop running; the area time zone set |
| 6 | Support for drivers, then attachments | 14 | Attachments need the storage bucket |
| 7 | Refunds in the console and the dashboard figures | 7 | Operator `refund` permission; webhook forwarding for Stripe-side changes |
| 8 | Notifications, quiet hours and recovery after a missed push | 8 | Development build, EAS project ID, Android push credentials |
| 9 | Background location, account deletion, accessibility, share link | 9–12 | Development build for background location; `CLERK_SECRET_KEY` for deletion |

## What has not been run by anyone yet

Everything in the table above. Automated checks used stand-ins for Clerk, Stripe, Google, storage and push, and no screen has been opened on a phone. With the current `.env`, sections 8 (push), 14 (attachments) and the document part of driver approval cannot be run until their settings are added.

Driver payouts are not part of this test. They remain blocked; see [payout-readiness.md](payout-readiness.md).
