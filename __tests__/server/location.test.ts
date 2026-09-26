import { LOCATION, validateLocation } from "../../server/location";
import { getRide } from "../../server/routes/rides";

import {
  call,
  createContext,
  resetDb,
  testDb,
  type TestContext,
} from "./helpers";
import {
  advanceClock,
  apply,
  assertInvariants,
  assign,
  assignedRide,
  fix,
  goOffline,
  onlineDriver,
  postLocation,
  requestRide,
  setStatus,
  watch,
} from "./scenario";

const db = testDb();
let ctx: TestContext;

beforeEach(async () => {
  await resetDb(db);
  ctx = createContext(db);
});
afterEach(() => assertInvariants(ctx));
afterAll(() => db.end());

const P = "user_passenger";
const D = "user_driver";
const at = () => ctx.clock.now;

const stored = async () =>
  (
    await db.query(
      "SELECT latitude, longitude, location_seq, location_accuracy_m FROM mobility.driver_profiles",
    )
  ).rows[0];

describe("who may update a location", () => {
  it("rejects passengers and pending drivers", async () => {
    const passenger = await postLocation(ctx, P, fix(100, { at: at() }));
    expect(passenger.status).toBe(403);
    expect(passenger.json.error.code).toBe("NOT_A_DRIVER");

    await apply(ctx, D);
    const pending = await postLocation(ctx, D, fix(100, { at: at() }));
    expect(pending.status).toBe(403);
    expect(pending.json.error.code).toBe("DRIVER_NOT_APPROVED");
  });

  it("only ever updates the caller's own profile", async () => {
    await onlineDriver(ctx, D, 500);
    await onlineDriver(ctx, "user_other_driver", 5000);
    advanceClock(ctx, 5);
    await postLocation(ctx, D, fix(600, { at: at() }));
    const { rows } = await db.query(
      `SELECT u.clerk_id, round(dp.latitude::numeric, 5) AS lat
         FROM mobility.driver_profiles dp JOIN mobility.users u ON u.id = dp.user_id
        ORDER BY u.clerk_id`,
    );
    expect(rows.map((r) => r.clerk_id)).toEqual([
      "user_driver",
      "user_other_driver",
    ]);
    expect(Number(rows[0].lat)).toBeCloseTo(fix(600).latitude, 4);
    expect(Number(rows[1].lat)).toBeCloseTo(fix(5000).latitude, 4);
  });

  it("does not accept updates from an offline driver without a ride", async () => {
    await onlineDriver(ctx, D);
    await goOffline(ctx, D);
    advanceClock(ctx, 5);
    const res = await postLocation(ctx, D, fix(100, { at: at() }));
    expect(res.json.data).toEqual({
      accepted: false,
      reason: "not_sharing",
      sharing: false,
    });
    expect((await stored()).latitude).toBeNull();
  });
});

describe("validation", () => {
  it.each([
    ["latitude out of range", { latitude: 91 }],
    ["longitude out of range", { longitude: 181 }],
    ["missing timestamp", { recordedAt: undefined }],
    ["unknown field", { driverId: "someone-else" }],
  ])("rejects %s with 400", async (_n, patch) => {
    await onlineDriver(ctx, D);
    const res = await postLocation(ctx, D, {
      ...fix(100, { at: at() }),
      ...patch,
    } as never);
    expect(res.status).toBe(400);
  });

  it("rejects stale, future, inaccurate, impossible, and out-of-order fixes", async () => {
    await onlineDriver(ctx, D, 500);
    advanceClock(ctx, 5);
    const reason = async (body: ReturnType<typeof fix>) =>
      (await postLocation(ctx, D, body)).json.data.reason;

    expect(
      await reason(
        fix(510, { at: at(), secondsAgo: LOCATION.maxAgeSeconds + 5 }),
      ),
    ).toBe("stale");
    expect(await reason(fix(510, { at: at(), secondsAgo: -120 }))).toBe(
      "future",
    );
    expect(await reason(fix(510, { at: at(), accuracy: 900 }))).toBe(
      "low_accuracy",
    );
    expect(await reason(fix(40_000, { at: at() }))).toBe("jump");
    expect(await reason(fix(520, { at: at(), secondsAgo: 60 }))).toBe(
      "out_of_order",
    );

    const before = await stored();
    expect(Number(before.latitude)).toBeCloseTo(fix(500).latitude, 5);
  });

  it("throttles bursts but accepts a steady stream", async () => {
    await onlineDriver(ctx, D, 500);
    advanceClock(ctx, 5);
    expect(
      (await postLocation(ctx, D, fix(520, { at: at() }))).json.data.accepted,
    ).toBe(true);
    advanceClock(ctx, 1);
    expect(
      (await postLocation(ctx, D, fix(530, { at: at() }))).json.data.reason,
    ).toBe("throttled");
    advanceClock(ctx, 4);
    expect(
      (await postLocation(ctx, D, fix(560, { at: at() }))).json.data.accepted,
    ).toBe(true);
  });

  it("allows a large move after a long gap", () => {
    const now = new Date();
    const previous = {
      latitude: 37.7,
      longitude: -122.4,
      location_updated_at: new Date(
        now.getTime() - (LOCATION.jumpResetSeconds + 10) * 1000,
      ),
      location_received_at: new Date(now.getTime() - 3600_000),
      location_accuracy_m: 10,
    };
    expect(
      validateLocation(
        {
          latitude: 37.9,
          longitude: -122.4,
          accuracy: 10,
          recordedAt: now.toISOString(),
        },
        previous,
        now,
      ),
    ).toBeNull();
  });
});

describe("visibility", () => {
  it("shows the driver's position only to the assigned passenger during the ride", async () => {
    const rideId = await assignedRide(ctx, P, D, 800);
    advanceClock(ctx, 5);
    await postLocation(ctx, D, fix(700, { at: at() }));

    const mine = await watch(ctx, P, rideId);
    expect(mine.status).toBe(200);
    expect(mine.json.data.live.driverLocation).toMatchObject({
      freshness: "live",
    });
    expect(mine.json.data.live.locationStatus).toBe("live");

    expect((await watch(ctx, "user_stranger", rideId)).status).toBe(404);

    const status = await call(ctx, getRide, {
      user: P,
      params: { id: rideId },
    });
    expect(JSON.stringify(status.json.data)).not.toContain("accuracyMeters");
    expect(status.json.data.driver).not.toHaveProperty("latitude");
  });

  it("never shares the driver's position before acceptance or after the ride ends", async () => {
    await onlineDriver(ctx, D, 800);
    const { rideId } = await requestRide(ctx, P);
    const searching = await watch(ctx, P, rideId);
    expect(searching.json.data.live).toMatchObject({
      locationStatus: "not_shared",
      driverLocation: null,
    });

    await assign(ctx, D, rideId);
    for (const s of ["arriving", "arrived", "in_progress", "completed"]) {
      await setStatus(ctx, D, rideId, s);
    }
    const done = await watch(ctx, P, rideId);
    expect(done.json.data.live).toMatchObject({
      locationStatus: "not_shared",
      driverLocation: null,
      eta: null,
    });
  });

  it("labels an ageing position as recent, then hides it instead of calling it live", async () => {
    const rideId = await assignedRide(ctx, P, D, 800);
    advanceClock(ctx, LOCATION.liveSeconds + 5);
    const recent = await watch(ctx, P, rideId);
    expect(recent.json.data.live.driverLocation.freshness).toBe("recent");
    expect(recent.json.data.live.driverLocation.ageSeconds).toBeGreaterThan(
      LOCATION.liveSeconds,
    );

    advanceClock(ctx, LOCATION.recentSeconds);
    const old = await watch(ctx, P, rideId);
    expect(old.json.data.live).toMatchObject({
      locationStatus: "unavailable",
      driverLocation: null,
    });
  });

  it("stops sharing when the driver goes offline", async () => {
    await onlineDriver(ctx, D, 800);
    expect((await stored()).latitude).not.toBeNull();
    await goOffline(ctx, D);
    expect(await stored()).toMatchObject({ latitude: null, longitude: null });
  });
});
