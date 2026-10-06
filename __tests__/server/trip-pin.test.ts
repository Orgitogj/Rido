import { derivePin, pinMatches, pinSecret } from "../../server/pin";
import { rideDetail, waiveRidePin } from "../../server/routes/admin";
import { getInbox } from "../../server/routes/inbox";
import { updateRideStatus } from "../../server/routes/rides";
import { createShare, viewShare } from "../../server/routes/safety";
import { RIDE_PIN } from "../../shared/contracts";

import {
  call,
  createContext,
  resetDb,
  sessionToken,
  TEST_PIN_SECRET,
  testDb,
  type TestContext,
} from "./helpers";
import {
  adminGet,
  adminPost,
  advanceClock,
  assertInvariants,
  assign,
  cancel,
  dashboard,
  drive,
  makeOperator,
  onlineDriver,
  registerDevice,
  requestRide,
  setStatus,
  tripPin,
  viewRide,
  watch,
} from "./scenario";

import type { AdminRideDetail, RideView } from "../../shared/contracts";

const db = testDb();
let ctx: TestContext;

beforeEach(async () => {
  await resetDb(db);
  ctx = createContext(db);
});
afterEach(() => assertInvariants(ctx));
afterAll(() => db.end());

const P = "user_passenger";
const A = "user_driver_a";
const B = "user_driver_b";
const OPS = "user_operator";
const VIEW = "user_viewer";

const wrongPin = (pin: string) =>
  String((Number(pin) + 1) % 10_000).padStart(4, "0");

async function atPickup(driver = A) {
  await onlineDriver(ctx, driver, 400);
  const { rideId, intentId } = await requestRide(ctx, P);
  await assign(ctx, driver, rideId);
  await drive(ctx, driver, rideId, "arrived");
  return { rideId, intentId, pin: (await tripPin(ctx, rideId))! };
}

const rideOf = async (user: string, rideId: string) =>
  (await viewRide(ctx, user, rideId)).json.data as RideView;

const rowOf = async (rideId: string) =>
  (
    await db.query<{
      status: string;
      pin_failed_attempts: number;
      pin_lockouts: number;
      pin_locked_until: Date | null;
      pin_verified_at: Date | null;
      pin_nonce: string | null;
      fare_cents: number;
    }>("SELECT * FROM mobility.rides WHERE id = $1", [rideId])
  ).rows[0];

describe("pin derivation", () => {
  it("needs a long secret, is stable per assignment and changes with the nonce", () => {
    expect(pinSecret({ RIDE_PIN_SECRET: "short" })).toBeNull();
    expect(pinSecret({})).toBeNull();
    expect(pinSecret({ RIDE_PIN_SECRET: TEST_PIN_SECRET })).toBe(
      TEST_PIN_SECRET,
    );
    const a = derivePin(TEST_PIN_SECRET, "ride-1", "nonce-1");
    expect(a).toMatch(/^\d{4}$/);
    expect(derivePin(TEST_PIN_SECRET, "ride-1", "nonce-1")).toBe(a);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(derivePin(TEST_PIN_SECRET, "ride-1", `nonce-${i}`));
    }
    expect(seen.size).toBeGreaterThan(150);
    expect(
      derivePin("another-secret-another-secret-12345", "ride-1", "nonce-1"),
    ).not.toBe(
      derivePin("yet-another-secret-yet-another-123456", "ride-1", "nonce-1"),
    );
    expect(pinMatches(TEST_PIN_SECRET, "ride-1", "nonce-1", a)).toBe(true);
    expect(pinMatches(TEST_PIN_SECRET, "ride-1", "nonce-1", wrongPin(a))).toBe(
      false,
    );
    expect(pinMatches(TEST_PIN_SECRET, "ride-1", "nonce-1", "")).toBe(false);
  });
});

describe("trip PIN", () => {
  it("shows the PIN only to the passenger and starts the trip only with it", async () => {
    await registerDevice(ctx, P, "ExponentPushToken[passenger]");
    const { rideId, pin, intentId } = await atPickup();

    const passenger = await rideOf(P, rideId);
    expect(passenger.pin).toBe(pin);
    expect(passenger.pinEntry).toBeNull();
    const driver = await rideOf(A, rideId);
    expect(driver.pin).toBeNull();
    expect(driver.pinEntry).toEqual({
      required: true,
      attemptsLeft: RIDE_PIN.maxAttempts,
      lockedUntil: null,
      blocked: false,
    });
    expect(JSON.stringify(driver)).not.toContain(`"${pin}"`);
    expect(JSON.stringify(await dashboard(ctx, A))).not.toContain(`"${pin}"`);
    const driverWatch = await watch(ctx, A, rideId);
    expect(JSON.stringify(driverWatch.json)).not.toContain(`"${pin}"`);

    const missing = await setStatus(ctx, A, rideId, "in_progress", null);
    expect(missing.status).toBe(409);
    expect(missing.json.error.code).toBe("PIN_REQUIRED");
    expect((await rowOf(rideId)).pin_failed_attempts).toBe(0);

    const started = await setStatus(ctx, A, rideId, "in_progress", pin);
    expect(started.status).toBe(200);
    expect(started.json.data.status).toBe("in_progress");
    expect((await rowOf(rideId)).pin_verified_at).not.toBeNull();
    expect((await rideOf(P, rideId)).pin).toBeNull();

    expect((await setStatus(ctx, A, rideId, "completed")).status).toBe(200);
    expect(ctx.stripe.intents.get(intentId)!.status).toBe("succeeded");
    expect(ctx.stripe.effectiveCaptures).toBe(1);
    expect((await rowOf(rideId)).fare_cents).toBe(
      ctx.stripe.intents.get(intentId)!.amountReceived,
    );

    const texts = [
      ...ctx.push.sent.map(
        (m) => `${m.title} ${m.body} ${JSON.stringify(m.data)}`,
      ),
      ...(
        await db.query<{ t: string }>(
          `SELECT title || ' ' || body || ' ' || data::text AS t FROM mobility.notifications
           UNION ALL SELECT COALESCE(reason, '') FROM mobility.ride_events
           UNION ALL SELECT detail::text || COALESCE(reason, '') FROM mobility.audit_log`,
        )
      ).rows.map((r) => r.t),
    ].join("\n");
    expect(texts).not.toMatch(new RegExp(`\\b${pin}\\b`));
  });

  it("keeps the PIN out of the public share page and the operator view", async () => {
    await makeOperator(ctx, OPS, "view,support");
    const { rideId, pin } = await atPickup();
    const share = await call(ctx, createShare, {
      user: P,
      params: { id: rideId },
      body: {},
    });
    expect(share.status).toBe(201);
    const shared = await call(ctx, viewShare, {
      params: { token: share.json.data.token },
    });
    expect(shared.status).toBe(200);
    expect(JSON.stringify(shared.json)).not.toMatch(/pin/i);
    const detail = await adminGet(ctx, OPS, rideDetail, {
      params: { id: rideId },
    });
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.json)).not.toContain(`"${pin}"`);
    expect(JSON.stringify(detail.json)).not.toMatch(/pin_nonce|nonce/);
    expect((detail.json.data as AdminRideDetail).pin).toMatchObject({
      required: true,
      canWaive: true,
      failedAttempts: 0,
    });
  });

  it("counts wrong PINs, locks for a bounded time and then blocks until support or a re-match", async () => {
    const { rideId, pin } = await atPickup();
    const bad = wrongPin(pin);

    for (let i = 1; i < RIDE_PIN.maxAttempts; i++) {
      const res = await setStatus(ctx, A, rideId, "in_progress", bad);
      expect(res.status).toBe(422);
      expect(res.json.error.code).toBe("PIN_INCORRECT");
      expect((await rideOf(A, rideId)).pinEntry!.attemptsLeft).toBe(
        RIDE_PIN.maxAttempts - i,
      );
    }
    const locked = await setStatus(ctx, A, rideId, "in_progress", bad);
    expect(locked.status).toBe(429);
    expect(locked.json.error.code).toBe("PIN_LOCKED");
    expect(locked.response.headers.get("Retry-After")).toBe(
      String(RIDE_PIN.lockoutSeconds),
    );

    const whileLocked = await setStatus(ctx, A, rideId, "in_progress", pin);
    expect(whileLocked.status).toBe(429);
    expect((await rowOf(rideId)).status).toBe("arrived");
    expect((await rideOf(A, rideId)).pinEntry!.lockedUntil).not.toBeNull();

    advanceClock(ctx, RIDE_PIN.lockoutSeconds + 1);
    expect((await rideOf(A, rideId)).pinEntry).toMatchObject({
      lockedUntil: null,
      attemptsLeft: RIDE_PIN.maxAttempts,
      blocked: false,
    });

    for (let lockout = 2; lockout <= RIDE_PIN.maxLockouts; lockout++) {
      for (let i = 0; i < RIDE_PIN.maxAttempts; i++) {
        await setStatus(ctx, A, rideId, "in_progress", bad);
      }
      advanceClock(ctx, RIDE_PIN.lockoutSeconds + 1);
    }
    const row = await rowOf(rideId);
    expect(row.pin_lockouts).toBe(RIDE_PIN.maxLockouts);
    const blocked = await setStatus(ctx, A, rideId, "in_progress", pin);
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.code).toBe("PIN_BLOCKED");
    expect((await rideOf(A, rideId)).pinEntry!.blocked).toBe(true);
    expect((await rowOf(rideId)).status).toBe("arrived");
    expect((await rideOf(P, rideId)).pin).toBe(pin);
  });

  it("doesn't count requests that fail authentication or come from other users", async () => {
    const { rideId, pin } = await atPickup();
    await onlineDriver(ctx, B, 5000);
    const expired = await call(ctx, updateRideStatus, {
      token: `Bearer ${sessionToken(A, { expiresInSeconds: -120 })}`,
      params: { id: rideId },
      body: { status: "in_progress", pin: wrongPin(pin) },
    });
    expect(expired.status).toBe(401);
    expect(
      (await setStatus(ctx, B, rideId, "in_progress", wrongPin(pin))).status,
    ).toBe(404);
    expect((await setStatus(ctx, P, rideId, "in_progress", pin)).status).toBe(
      403,
    );
    expect(
      (
        await call(ctx, updateRideStatus, {
          user: A,
          params: { id: rideId },
          body: { status: "in_progress", pin: "12" },
        })
      ).status,
    ).toBe(400);
    const row = await rowOf(rideId);
    expect([row.pin_failed_attempts, row.pin_lockouts, row.status]).toEqual([
      0,
      0,
      "arrived",
    ]);
  });

  it("starts once under concurrent correct starts and stays idempotent on retries", async () => {
    const { rideId, pin, intentId } = await atPickup();
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => setStatus(ctx, A, rideId, "in_progress", pin)),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM mobility.ride_events
        WHERE ride_id = $1 AND to_status = 'in_progress'`,
      [rideId],
    );
    expect(rows[0].n).toBe(1);

    for (const retry of [pin, wrongPin(pin), null]) {
      const again = await setStatus(ctx, A, rideId, "in_progress", retry);
      expect(again.status).toBe(200);
      expect(again.json.data.status).toBe("in_progress");
    }
    expect((await rowOf(rideId)).pin_failed_attempts).toBe(0);
    await setStatus(ctx, A, rideId, "completed");
    await setStatus(ctx, A, rideId, "completed");
    expect(ctx.stripe.effectiveCaptures).toBe(1);
    expect(ctx.stripe.intents.get(intentId)!.status).toBe("succeeded");
  });

  it("counts every wrong attempt under concurrency and never exceeds the limit", async () => {
    const { rideId, pin } = await atPickup();
    const bad = wrongPin(pin);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        setStatus(ctx, A, rideId, "in_progress", bad),
      ),
    );
    const codes = results.map((r) => r.json.error.code);
    expect(codes.filter((c) => c === "PIN_INCORRECT")).toHaveLength(
      RIDE_PIN.maxAttempts - 1,
    );
    expect(codes.filter((c) => c === "PIN_LOCKED")).toHaveLength(
      8 - (RIDE_PIN.maxAttempts - 1),
    );
    const row = await rowOf(rideId);
    expect([row.pin_lockouts, row.status]).toEqual([1, "arrived"]);
  });

  it("rotates the PIN on re-match so a former driver can't use the old one", async () => {
    await onlineDriver(ctx, A, 300);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    await drive(ctx, A, rideId, "arrived");
    const first = (await tripPin(ctx, rideId))!;
    const bad = wrongPin(first);
    await setStatus(ctx, A, rideId, "in_progress", bad);
    expect((await rowOf(rideId)).pin_failed_attempts).toBe(1);

    expect((await cancel(ctx, A, rideId)).status).toBe(200);
    const searching = await rowOf(rideId);
    expect([searching.pin_nonce, searching.pin_failed_attempts]).toEqual([
      null,
      0,
    ]);
    expect((await rideOf(P, rideId)).pin).toBeNull();

    await onlineDriver(ctx, B, 600);
    await assign(ctx, B, rideId);
    await drive(ctx, B, rideId, "arrived");
    const second = (await tripPin(ctx, rideId))!;
    expect((await rowOf(rideId)).pin_nonce).not.toBeNull();
    expect((await rideOf(P, rideId)).pin).toBe(second);

    const former = await setStatus(ctx, A, rideId, "in_progress", second);
    expect(former.status).toBe(404);
    expect((await viewRide(ctx, A, rideId)).status).toBe(404);
    expect((await rowOf(rideId)).status).toBe("arrived");
    if (first !== second) {
      const stale = await setStatus(ctx, B, rideId, "in_progress", first);
      expect(stale.status).toBe(422);
    }
    expect(
      (await setStatus(ctx, B, rideId, "in_progress", second)).status,
    ).toBe(200);
  });

  it("lets only support operators waive the PIN at the pickup, with a reason and an audit entry", async () => {
    await makeOperator(ctx, OPS, "view,support");
    await makeOperator(ctx, VIEW, "view");
    await onlineDriver(ctx, A, 300);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, A, rideId);
    const reason = "Passenger's phone died; identity confirmed by phone call.";

    const early = await adminPost(
      ctx,
      OPS,
      waiveRidePin,
      { id: rideId },
      { reason },
    );
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe("NOT_AT_PICKUP");
    await drive(ctx, A, rideId, "arrived");

    expect(
      (await adminPost(ctx, VIEW, waiveRidePin, { id: rideId }, { reason }))
        .status,
    ).toBe(403);
    expect(
      (await adminPost(ctx, A, waiveRidePin, { id: rideId }, { reason }))
        .status,
    ).toBe(403);
    expect(
      (
        await adminPost(
          ctx,
          OPS,
          waiveRidePin,
          { id: rideId },
          { reason: "ok" },
        )
      ).status,
    ).toBe(400);
    expect((await setStatus(ctx, A, rideId, "in_progress", null)).status).toBe(
      409,
    );

    const waived = await adminPost(
      ctx,
      OPS,
      waiveRidePin,
      { id: rideId },
      { reason },
    );
    expect(waived.status).toBe(200);
    expect(
      (await adminPost(ctx, OPS, waiveRidePin, { id: rideId }, { reason }))
        .status,
    ).toBe(200);
    expect((await rideOf(A, rideId)).pinEntry!.required).toBe(false);
    expect((await rideOf(P, rideId)).pin).toBeNull();

    const inbox = await call(ctx, getInbox, {
      user: P,
      url: "http://localhost/api/notifications",
    });
    expect(
      inbox.json.data.items.filter(
        (i: { kind: string }) => i.kind === "pin_waived",
      ),
    ).toHaveLength(1);

    expect((await setStatus(ctx, A, rideId, "in_progress", null)).status).toBe(
      200,
    );
    const { rows: audit } = await db.query<{ result: string; reason: string }>(
      "SELECT result, reason FROM mobility.audit_log WHERE action = 'pin_waive' ORDER BY id",
    );
    expect(audit.map((a) => a.result)).toEqual([
      "failed",
      "succeeded",
      "succeeded",
    ]);
    expect(audit[1].reason).toBe(reason);
    const { rows: events } = await db.query<{ actor: string }>(
      "SELECT actor FROM mobility.ride_events WHERE ride_id = $1 AND reason = 'pin_waived'",
      [rideId],
    );
    expect(events).toEqual([{ actor: "operator" }]);
  });

  it("drops a waiver when the ride is re-matched", async () => {
    await makeOperator(ctx, OPS, "view,support");
    const { rideId } = await atPickup(A);
    await adminPost(
      ctx,
      OPS,
      waiveRidePin,
      { id: rideId },
      { reason: "Passenger can't open the app at the pickup." },
    );
    await cancel(ctx, A, rideId);
    await onlineDriver(ctx, B, 600);
    await assign(ctx, B, rideId);
    await drive(ctx, B, rideId, "arrived");
    expect((await setStatus(ctx, B, rideId, "in_progress", null)).status).toBe(
      409,
    );
  });

  it("doesn't require a PIN for rides assigned before the feature or without a secret", async () => {
    const { rideId } = await atPickup();
    await db.query("UPDATE mobility.rides SET pin_nonce = NULL WHERE id = $1", [
      rideId,
    ]);
    expect((await rideOf(P, rideId)).pin).toBeNull();
    expect((await rideOf(A, rideId)).pinEntry!.required).toBe(false);
    expect((await setStatus(ctx, A, rideId, "in_progress", null)).status).toBe(
      200,
    );
    await setStatus(ctx, A, rideId, "completed");

    delete process.env.RIDE_PIN_SECRET;
    try {
      const { rideId: second } = await requestRide(ctx, P);
      await assign(ctx, A, second);
      expect((await rowOf(second)).pin_nonce).toBeNull();
      await drive(ctx, A, second, "arrived");
      expect(
        (await setStatus(ctx, A, second, "in_progress", null)).status,
      ).toBe(200);
    } finally {
      process.env.RIDE_PIN_SECRET = TEST_PIN_SECRET;
    }
  });

  it("refuses to start, without guessing, when the secret disappears after assignment", async () => {
    const { rideId, pin } = await atPickup();
    delete process.env.RIDE_PIN_SECRET;
    try {
      const res = await setStatus(ctx, A, rideId, "in_progress", pin);
      expect(res.status).toBe(503);
      expect(res.json.error.code).toBe("PIN_UNAVAILABLE");
      expect((await rowOf(rideId)).status).toBe("arrived");
    } finally {
      process.env.RIDE_PIN_SECRET = TEST_PIN_SECRET;
    }
    expect((await setStatus(ctx, A, rideId, "in_progress", pin)).status).toBe(
      200,
    );
  });
});
