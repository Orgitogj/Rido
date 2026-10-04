# Rido

A two-sided ride-hailing app built with Expo, React Native, Expo Router API routes and PostgreSQL.

## Project Overview

This repository contains a passenger app, a driver app and a web operations console, served from one codebase. It demonstrates:

- Booking a ride with a fixed, road-based price shown before the request
- Driver applications reviewed by a person, then live matching, offers and trip progress
- Vehicle categories, passenger count, up to two stops and scheduled requests
- A trip PIN the driver must enter before the trip can start
- Payment in the vehicle (card terminal or cash) in Albanian lek, recorded by the driver
- Live ride status and driver position, ride chat, ratings, safety reports and trip sharing
- Support conversations with private photo attachments for passengers and drivers
- A web console for operators: review queue, support, drivers, service areas, fares, driver balances and a dashboard
- English and Albanian throughout the passenger and driver app

The server owns identity, pricing, matching, ride state and payment state. The apps only display that state and ask to change it.

The full description of every rule, API route and test is in [docs/reference.md](docs/reference.md).

## Key Technologies

- `expo` / `expo-router` (screens and `+api.ts` server routes)
- `react-native`
- `@clerk/expo` (accounts and sessions)
- `pg` with PostgreSQL
- `zod` (shared request and response contracts)
- `zustand`
- `react-native-maps` and the Google Routes API
- `nativewind`
- `typescript`
- `stripe` (optional card mode, switched off by default)

## Database Schema

The schema is 25 numbered migrations in `db/migrations/`, applied in filename order into the `mobility` schema. The main entities are:

- `users` — accounts synced from Clerk, language and notification preferences
- `driver_profiles` / `driver_documents` — driver applications, vehicles, documents and review history
- `vehicle_categories` / `driver_vehicle_categories` — operator-managed categories and which drivers may serve them
- `service_areas` / `fare_policies` — where rides are offered and versioned prices per area and category
- `quotes` — priced routes, valid for ten minutes
- `rides` — the ride, its status, stops, PIN state, payment method and collection state
- `ride_offers` / `ride_events` — offers made to drivers and the audit trail of every status change
- `scheduled_rides` — saved requests the passenger confirms shortly before pickup
- `ride_messages` / `ratings` — ride chat and ratings
- `safety_reports` / `trip_shares` — safety reports and public trip links
- `support_requests` / `support_messages` / `support_attachments` — support conversations
- `notifications` / `push_tokens` — inbox items and push delivery
- `ride_earnings` / `earning_entries` — the append-only driver earnings ledger
- `driver_settlements` — transfers to and from drivers that operators record
- `operators` / `audit_log` — console access and every operator action
- `saved_places`, `account_deletions`, `rate_limits`, `job_status` — places, deletion, limits and background jobs

Additional database behavior:

- Migrations are additive and tracked in `public.mobility_schema_migrations`
- Check constraints guard ride status, payment state, stop progress and currency
- The seed adds one labelled development area, category and fare example in lek

## Security model

- **Prices are never set by the client.** The server prices the driving route with the area's fare policy, and a ride is created only from a server quote.
- **Status is never written by the client.** Every change goes through one state machine that checks the actor, locks the ride row and records the event.
- **Roles cannot be self-assigned.** Drivers are approved by an operator, vehicle categories are assigned by an operator, and operator access is granted only from the CLI.
- **A trip can't start without the passenger's PIN.** It is shown only to the passenger, checked in the same transaction that starts the trip, limited to a few attempts, and replaced when the ride is re-matched.
- **Repeat submissions are safe.** Bookings, payments recorded by the driver, support requests, scheduled requests and operator transfers are idempotent.
- **Ownership is checked on every route.** Another user's ride, receipt, place, request or attachment answers 404.
- **Driver location is scoped and temporary.** Only the assigned passenger sees it, only during the ride.
- **Files are private.** Driver documents and support attachments live in a private bucket and are opened through 60-second links; every operator view is audited.
- **Operator notes stay internal.** They are never returned by passenger or driver routes or put in notifications.
- **The app charges no card by default.** The passenger pays the driver, and the driver records how. An unpaid trip goes to support and blocks the passenger's next request.
- **Secrets stay on the server.** The console, pricing controls and server keys are not in the Android or iOS bundle.

## Setup Instructions

### 1. Clone the repository

```bash
git clone https://github.com/Orgitogj/Rido.git
cd Rido
```

### 2. Install dependencies

```bash
npm install
```

Use Node 24, the version CI runs.

### 3. Create environment variables

```bash
cp .env.example .env
```

Edit `.env` and set at least:

```
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=your-clerk-publishable-key
CLERK_SECRET_KEY=your-clerk-secret-key
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/uber
GOOGLE_ROUTES_API_KEY=your-server-routes-key
CRON_SECRET=a-long-random-value
RIDE_PIN_SECRET=at-least-32-random-characters
```

Only `EXPO_PUBLIC_*` values reach the app bundle. The full list of settings and what each one affects is in [docs/operations.md](docs/operations.md).

### 4. Set up the database

```bash
npm run db:setup
```

This applies every migration and the seed to the database in `DATABASE_URL`.

### 5. Create an operator, an area and a driver

```bash
npm run admin -- grant-operator <clerkUserId> --name "Your name" --permissions view,support,refund,verify,configure
```

Then open `/admin` in a browser, create a service area with a fare policy in lek, activate it, and approve a driver. The step-by-step guide is in [docs/manual-test-setup.md](docs/manual-test-setup.md).

### 6. Run the app

```bash
npm start
```

Then open the app in one of the supported targets:

- Android emulator
- iOS simulator
- Expo Go

The operations console is at `http://localhost:8081/admin`.

## Payments

Passengers pay the driver on the business's card terminal or in cash at the end of the trip. The driver records which, and the app keeps each driver's balance with the business. Operators record the bank transfers they make outside the app; the app moves no money.

The earlier Stripe flow (card hold, then capture) is kept but switched off. To turn it on, set the Stripe keys and:

```
PAYMENT_MODE=card_online
APP_CURRENCY=usd
```

Automatic driver payouts are not built. See [docs/payout-readiness.md](docs/payout-readiness.md).

## Android map key

`react-native-maps` uses Google Maps on Android and needs an API key; iOS uses Apple Maps and needs nothing. Address search uses `EXPO_PUBLIC_GOOGLE_API_KEY`.

## End-to-end walkthrough

1. Passenger chooses pickup, destination, vehicle category and passenger count, sees the price and requests the ride.
2. Driver goes online, accepts the offer, drives to the pickup and enters the passenger's PIN to start.
3. Driver marks each stop, completes the trip, and records the payment as terminal or cash.
4. The passenger's receipt shows the payment, and the driver's earnings screen shows the balance.

Throughout, the passenger follows the driver on a map, both can chat, and each gets in-app notifications as the ride advances.

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint, zero warnings
npm test            # server and app tests
```

`npm test` needs no accounts, keys or network. Server tests run the real route handlers against an in-process PostgreSQL with stand-ins for Clerk, Google, storage, push and Stripe. CI runs the same three checks and repeats the server tests on PostgreSQL 16.

Tests with stand-ins are not verification of the real services. The checks that need real credentials and phones are in [docs/manual-test-checklist.md](docs/manual-test-checklist.md), and what is and is not verified is in [docs/implementation-checklist.md](docs/implementation-checklist.md).

## App Architecture

- `app/` — Expo Router screens; `app/api/` holds thin server route files
- `app/admin/` — operations console routes, loaded only on web
- `components/` — reusable UI; `components/admin/console/` holds the console pages
- `server/` — authentication, pricing, matching, ride lifecycle, payments, notifications and route handlers
- `shared/` — request and response contracts used by both the server and the app
- `lib/` — API client, live ride updates, location tracking, push and helpers
- `lib/i18n/` — English and Albanian text
- `store/` — booking state
- `db/migrations/` — numbered schema migrations; `db/seed.sql` — development examples
- `scripts/` — database and operator command-line tools
- `__tests__/` — server and app tests
- `docs/` — reference, operations guide, test checklists and payout notes

## GitHub

Repository: https://github.com/Orgitogj/Rido

## How to Review

A reviewer can verify:

- Sign-up, sign-in and account deletion through Clerk
- Quotes limited to active service areas and priced from the driving route
- Booking with category, passenger count and stops
- Driver approval, offers, the trip PIN and stop progress
- Recording the payment, unpaid trips and the driver balance
- Scheduled requests and their confirmation window
- Support conversations with attachments
- The operator console, its permissions and its audit trail
- Ownership and permission checks on every server route
