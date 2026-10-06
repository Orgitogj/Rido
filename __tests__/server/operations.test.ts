import { checkConfig, configReady } from "../../server/config";
import { claimJob, recordStep } from "../../server/jobs";
import { allow, RATE_LIMITS } from "../../server/rateLimit";
import { sweep } from "../../server/rides";
import { runSweep } from "../../server/routes/internal";
import { createPlace } from "../../server/routes/profile";
import { listRideHistory } from "../../server/routes/rides";
import { viewShare } from "../../server/routes/safety";
import { health, readiness, systemStatus } from "../../server/routes/system";

import {
  call,
  createContext,
  PICKUP,
  resetDb,
  testDb,
  type TestContext,
} from "./helpers";
import {
  adminGet,
  advanceClock,
  assertInvariants,
  cancel,
  makeOperator,
  requestRide,
} from "./scenario";

import type { SystemStatus } from "../../shared/adminSystem";
import type { Page, RideView } from "../../shared/contracts";

const db = testDb();
let ctx: TestContext;

beforeEach(async () => {
  await resetDb(db);
  await db.query("TRUNCATE mobility.rate_limits, mobility.job_status");
  ctx = createContext(db);
});
afterEach(() => assertInvariants(ctx));
afterAll(() => db.end());

const P = "user_passenger";
const OPS = "user_operator";

describe("health and readiness", () => {
  it("answers liveness without touching anything and readiness without secrets", async () => {
    expect((await call(ctx, health, {})).json).toEqual({
      data: { status: "ok" },
    });
    const saved = { ...process.env };
    process.env.STRIPE_SECRET_KEY = "sk_test_readiness_secret_value";
    process.env.CRON_SECRET = "0123456789abcdef";
    process.env.GOOGLE_ROUTES_API_KEY = "routes-key-value";
    process.env.DATABASE_URL = "postgres://user:password@host/db";
    process.env.CLERK_JWT_KEY = "jwt-key";
    const ready = await call(ctx, readiness, {});
    expect(ready.status).toBe(200);
    expect(ready.json.data).toEqual({
      status: "ready",
      checks: { database: true, schema: true, configuration: true },
    });
    delete process.env.GOOGLE_ROUTES_API_KEY;
    const missing = await call(ctx, readiness, {});
    expect(missing.status).toBe(503);
    expect(missing.json.data.checks.configuration).toBe(false);
    const text = JSON.stringify([ready.json, missing.json]);
    for (const secret of [
      "readiness_secret",
      "password",
      "0123456789abcdef",
      "jwt-key",
    ]) {
      expect(text).not.toContain(secret);
    }
    process.env = saved;
  });

  it("validates configuration differently for development and production", () => {
    const base = {
      DATABASE_URL: "postgres://x",
      CLERK_JWT_KEY: "k",
      STRIPE_SECRET_KEY: "sk_test_x",
      CRON_SECRET: "0123456789abcdef",
      GOOGLE_ROUTES_API_KEY: "g",
      PAYMENT_MODE: "card_online",
    };
    expect(configReady(base)).toBe(true);
    expect(
      configReady({
        ...base,
        PAYMENT_MODE: "in_vehicle",
        STRIPE_SECRET_KEY: undefined,
      }),
    ).toBe(true);
    expect(configReady({ ...base, CRON_SECRET: "short" })).toBe(false);
    expect(configReady({ ...base, STRIPE_SECRET_KEY: "pk_test_wrong" })).toBe(
      false,
    );
    const production = { ...base, NODE_ENV: "production" };
    expect(configReady(production)).toBe(false);
    expect(
      configReady({
        ...production,
        CLERK_AUTHORIZED_PARTIES: "https://app.example",
        STRIPE_WEBHOOK_SECRET: "whsec_x",
        EXPO_PUBLIC_SERVER_URL: "https://api.example",
      }),
    ).toBe(false);
    expect(
      configReady({
        ...production,
        CLERK_AUTHORIZED_PARTIES: "https://app.example",
        STRIPE_WEBHOOK_SECRET: "whsec_x",
        EXPO_PUBLIC_SERVER_URL: "https://api.example",
        RIDE_PIN_SECRET: "0123456789abcdef0123456789abcdef",
      }),
    ).toBe(true);
    const live = checkConfig({ ...base, STRIPE_SECRET_KEY: "sk_live_x" }).find(
      (c) => c.name === "STRIPE_SECRET_KEY",
    )!;
    expect(live.note).toContain("Live key");
    expect(JSON.stringify(checkConfig(base))).not.toContain("sk_test_x");
  });
});

describe("background jobs", () => {
  it("lets only one scheduled sweep run at a time and records it", async () => {
    process.env.CRON_SECRET = "test-cron-secret-123";
    const run = () =>
      call(ctx, runSweep, {
        method: "POST",
        token: "Bearer test-cron-secret-123",
      });
    expect(
      (await call(ctx, runSweep, { method: "POST", token: "Bearer nope" }))
        .status,
    ).toBe(401);
    await db.query(
      "INSERT INTO mobility.job_status (name, lease_until) VALUES ('sweep', $1)",
      [new Date(ctx.clock.now.getTime() + 60_000)],
    );
    const skipped = await run();
    expect(skipped.json.data).toEqual({
      processed: 0,
      skipped: "already_running",
    });
    advanceClock(ctx, 61);
    const ok = await run();
    expect(ok.json.data).toEqual({ processed: 0 });
    const { rows } = await db.query(
      "SELECT lease_until, last_ok_at IS NOT NULL AS ok, last_error FROM mobility.job_status WHERE name = 'sweep'",
    );
    expect(rows[0]).toEqual({ lease_until: null, ok: true, last_error: null });
  });

  it("records a failing maintenance step so operators can see it", async () => {
    const error = await recordStep(
      db,
      "example_step",
      ctx.clock.now,
      async () => {
        throw new Error("provider exploded");
      },
    );
    expect(error).toBe("provider exploded");
    await recordStep(db, "example_step", ctx.clock.now, async () => {});
    const { rows } = await db.query(
      "SELECT last_error, runs::int AS runs, failures::int AS failures, last_ok_at IS NOT NULL AS ok FROM mobility.job_status WHERE name = 'example_step'",
    );
    expect(rows[0]).toEqual({
      last_error: null,
      runs: 2,
      failures: 1,
      ok: true,
    });
    await sweep(ctx.deps);
    const { rows: steps } = await db.query(
      "SELECT name FROM mobility.job_status WHERE name <> 'example_step' ORDER BY name",
    );
    expect(steps.map((s) => s.name)).toEqual(
      expect.arrayContaining([
        "account_deletion",
        "driver_document_purge",
        "refund_sync",
      ]),
    );
  });

  it("throttles heartbeat-triggered maintenance with a lease", async () => {
    const now = ctx.clock.now;
    expect(await claimJob(db, "maintenance", now, 20)).toBe(true);
    expect(await claimJob(db, "maintenance", now, 20)).toBe(false);
    expect(
      await claimJob(db, "maintenance", new Date(now.getTime() + 21_000), 20),
    ).toBe(true);
  });
});

describe("rate limits", () => {
  it("caps requests per subject and window", async () => {
    const now = new Date("2026-01-01T10:00:10Z");
    const limit = RATE_LIMITS.accountDeletion.limit;
    for (let i = 0; i < limit; i++) {
      expect(await allow(db, "accountDeletion", "u1", now)).toBe(true);
    }
    expect(await allow(db, "accountDeletion", "u1", now)).toBe(false);
    expect(await allow(db, "accountDeletion", "u2", now)).toBe(true);
    expect(
      await allow(
        db,
        "accountDeletion",
        "u1",
        new Date("2026-01-01T11:00:01Z"),
      ),
    ).toBe(true);
  });

  it("answers 429 with Retry-After on protected endpoints", async () => {
    await db.query(
      `INSERT INTO mobility.rate_limits (key, window_start, count)
       SELECT 'placeWrites:' || u.id, to_timestamp(floor(extract(epoch FROM $1::timestamptz) / 600) * 600), 60
         FROM (SELECT id FROM mobility.users LIMIT 0) u`,
      [ctx.clock.now],
    );
    for (let i = 0; i < 3; i++) {
      await call(ctx, createPlace, {
        user: P,
        body: { kind: "home", ...PICKUP },
      });
    }
    await db.query(
      "UPDATE mobility.rate_limits SET count = 60 WHERE key LIKE 'placeWrites:%'",
    );
    const limited = await call(ctx, createPlace, {
      user: P,
      body: { kind: "home", ...PICKUP },
    });
    expect(limited.status).toBe(429);
    expect(Number(limited.response.headers.get("Retry-After"))).toBeGreaterThan(
      0,
    );

    const token = "a".repeat(43);
    await call(ctx, viewShare, { params: { token } });
    await db.query(
      "UPDATE mobility.rate_limits SET count = 120 WHERE key LIKE 'shareViews:%'",
    );
    expect((await call(ctx, viewShare, { params: { token } })).status).toBe(
      429,
    );
  });
});

describe("operator system view", () => {
  it("shows configuration status and queues without values, to operators only", async () => {
    await makeOperator(ctx, OPS, "view");
    const saved = { ...process.env };
    process.env.STRIPE_SECRET_KEY = "sk_test_system_secret";
    const res = await adminGet(ctx, OPS, systemStatus);
    process.env = saved;
    expect(res.status).toBe(200);
    const body = res.json.data as SystemStatus;
    expect(body.stripeMode).toBe("test");
    expect(body.config.find((c) => c.name === "STRIPE_SECRET_KEY")?.ok).toBe(
      true,
    );
    expect(body.queues).toMatchObject({
      notificationsPending: 0,
      accountDeletionsPending: 0,
      ridesNeedingReview: 0,
    });
    expect(JSON.stringify(res.json)).not.toContain("system_secret");
    expect((await adminGet(ctx, P, systemStatus)).status).toBe(403);
  });
});

describe("ride history", () => {
  it("pages a passenger's own rides", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { rideId } = await requestRide(ctx, P);
      ids.push(rideId);
      await cancel(ctx, P, rideId);
      await sweep(ctx.deps);
      advanceClock(ctx, 120);
    }
    const page = async (query: string, user = P) =>
      (
        await call(ctx, listRideHistory, {
          user,
          url: `http://localhost/api/rides/history${query}`,
        })
      ).json.data as Page<RideView>;
    const first = await page("?limit=2");
    expect(first.items.map((r) => r.id)).toEqual([ids[2], ids[1]]);
    const second = await page(`?limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((r) => r.id)).toEqual([ids[0]]);
    expect(second.nextCursor).toBeNull();
    expect((await page("", "user_other")).items).toEqual([]);
    expect(
      (
        await call(ctx, listRideHistory, {
          user: P,
          url: "http://localhost/api/rides/history?limit=500",
        })
      ).status,
    ).toBe(400);
  });
});
