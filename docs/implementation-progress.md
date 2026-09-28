**Implementation progress — 2026-09-06**

Base: branch `main`, commit `23ee9fe83093aef9fdc0c1619d5e1d2e568b4a24`. Existing untracked `.idea/` files and `docs/REPOSITORY_REVIEW.md` are preserved. No applicable AGENTS.md was found. Work is local; no deployments, live payments, or remote database mutations are authorized or performed.

**Baseline and inspection**

- Expo 54.0.36 / React Native 0.81.5 / React 19.1 / TypeScript 5.9; npm and package-lock.json.
- Traced Clerk signup/signin -> root guard -> location/driver selection -> PaymentSheet -> Stripe handlers -> client ride insertion -> ride history.
- Revalidated all six API handlers: no server authentication; client controls ride identity/payment state and Stripe amount/customer/intent selection. Random map positions and fallback fares remain. No migrations, CI, or tests exist.
- Read-only information-schema inspection succeeded. Existing `public.users`, `public.drivers`, and `public.rides` have the legacy columns described in the review. Unique Clerk/email mappings exist; rides reference drivers. No user, payment, or location records were read. No schema or data was changed.
- Typecheck passed. ESLint failed with three pre-existing formatting/import errors. Jest non-watch run failed because no tests exist. Offline Expo dependency check reports alignment with the installed SDK, with its offline limitation. Earlier Android export passed; earlier web export failed on native Stripe imports. Exports will be rechecked after implementation.
- Docker CLI is installed but the Docker engine is not running. Use a disposable embedded PostgreSQL engine for local database checks if available, and a PostgreSQL service in CI for transport/concurrency coverage. Never substitute the configured remote database for tests.

**Phases and acceptance criteria**

1. Secure foundation: shared server authentication, strict schemas, sanitized errors/request IDs, bounded/rate-limited requests, owned data access, authenticated profile sync, server-controlled roles, versioned additive schema, safe local/test migration and seed tooling, client auth integration, and meaningful tests. Acceptance: invalid credentials and spoofed identity/role/payment fields fail; zero coordinates validate; separate passengers cannot access each other's data; disposable database migration/seed and checks pass.
2. Trusted quote and payment: server-calculated USD quote, persisted pending booking, idempotent Stripe test PaymentIntent, PaymentSheet confirmation, verified/replay-safe webhook processing, recovery and compensation. Depends on phase 1. Acceptance: exact minor-unit amounts, no client-selected price/status, no duplicate effect, verified settlement and tested failure/recovery paths.
3. Ride fulfillment: centralized transition rules, eligible nearby driver matching, driver/admin modes, conditional acceptance, cancellation/timeouts, authenticated updates and reconnect snapshots. Depends on phase 2. Acceptance: one acceptance winner, no conflicting active driver rides, and persisted rider/driver agreement after reconnect.
4. Rider completion: profile, saved places, messaging, notifications, receipts/ratings, support, accessibility and platform parity, then Albanian localization separately. Depends on working secure core. Acceptance: useful states and role-protected flows with no fake-functional controls.
5. Release evidence: CI, exports, installed-device/manual test guide, deployment/runtime and rollback documentation, remaining provider-console tasks. Runs throughout; no production-readiness claim without device and service evidence.

**Implementation decisions**

- Preserve the existing visual identity and core stack. Use thin Expo API routes with server services and shared contracts.
- Use bearer session authentication for both native and browser API calls; do not accept cookies as implicit API credentials. Enforce explicit browser origins and Clerk authorized parties.
- Add new normalized tables in a separate `mobility` schema. Preserve legacy public tables and document historical import as a separately reviewed migration; do not guess or rewrite old money/status values.
- Target a Node server runtime. Keep realtime/background requirements explicit before choosing a transport or paid service.
- USD remains the currency. The planned initial policy is fixed-quote upfront payment, with auditable refunds for cancellation/no-driver outcomes; driver payouts are not implied.
- Dependency additions must have a concrete purpose: Clerk's server SDK for verified identity, runtime schemas for API contracts, PostgreSQL tooling for reproducible tests, and an embedded PostgreSQL test engine because local Docker is unavailable. No major Expo/React upgrades.

**Current status**

- [x] Repository/flow inspection and baseline checks.
- [x] Read-only legacy schema inspection.
- [x] Phase plan and safe execution boundaries.
- [ ] Phase 1 implementation and validation.
- [ ] Subsequent phases; report only actual completed work.

Next concrete task: implement and test the authenticated server boundary and additive database foundation, then connect the existing client to it.
