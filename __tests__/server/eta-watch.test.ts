import { ETA } from "../../server/live";
import { straightLineEstimate } from "../../server/routing";

import { createContext, resetDb, testDb, type TestContext } from "./helpers";
import {
  advanceClock,
  assertInvariants,
  assignedRide,
  fix,
  nearPickup,
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

describe("ETA", () => {
  it("uses the routing provider for the pickup leg and marks it estimated", async () => {
    const rideId = await assignedRide(ctx, P, D, 800);
    const res = await watch(ctx, P, rideId);
    const { live } = res.json.data;
    expect(live.leg).toBe("pickup");
    expect(live.eta).toMatchObject({
      leg: "pickup",
      source: "routed",
      durationSeconds: ctx.routing.durationSeconds,
      distanceMeters: 3100,
    });
    expect(new Date(live.eta.arrivalAt).getTime()).toBe(
      at().getTime() + ctx.routing.durationSeconds * 1000,
    );
    expect(live.route.polyline).toBeTruthy();
    expect(ctx.routing.calls).toHaveLength(1);
    expect(ctx.routing.calls[0].to).toEqual({
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    });
  });

  it("does not call the provider on every location update", async () => {
    const rideId = await assignedRide(ctx, P, D, 800);
    await watch(ctx, P, rideId);
    for (let i = 1; i <= 5; i++) {
      advanceClock(ctx, 5);
      await postLocation(ctx, D, fix(800 - i * 20, { at: at() }));
      await watch(ctx, P, rideId);
    }
    expect(ctx.routing.calls).toHaveLength(1);
  });

  it("refreshes after the minimum interval once the driver has moved far enough", async () => {
    const rideId = await assignedRide(ctx, P, D, 3000);
    await watch(ctx, P, rideId);

    advanceClock(ctx, ETA.minRefreshSeconds + 1);
    await postLocation(ctx, D, fix(2950, { at: at() }));
    await watch(ctx, P, rideId);
    expect(ctx.routing.calls).toHaveLength(1);

    advanceClock(ctx, 10);
    await postLocation(ctx, D, fix(2500, { at: at() }));
    await watch(ctx, P, rideId);
    expect(ctx.routing.calls).toHaveLength(2);
  });

  it("refreshes a stationary driver only after the maximum age", async () => {
    const rideId = await assignedRide(ctx, P, D, 800);
    await watch(ctx, P, rideId);
    advanceClock(ctx, 20);
    await postLocation(ctx, D, fix(801, { at: at() }));
    advanceClock(ctx, ETA.maxAgeSeconds);
    await postLocation(ctx, D, fix(802, { at: at() }));
    await watch(ctx, P, rideId);
    expect(ctx.routing.calls).toHaveLength(2);
  });

  it("falls back to a labelled straight-line estimate when routing fails", async () => {
    const rideId = await assignedRide(ctx, P, D, 800);
    ctx.routing.fail = true;
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { live } = (await watch(ctx, P, rideId)).json.data;
    errorSpy.mockRestore();
    const expected = straightLineEstimate(nearPickup(800), nearPickup(0));
    expect(live.eta).toMatchObject({
      source: "estimate",
      durationSeconds: expected.durationSeconds,
    });
    expect(live.route.polyline).toBeNull();
  });

  it("falls back to an estimate when no routing key is configured", async () => {
    const rideId = await assignedRide(ctx, P, D, 800);
    ctx.deps.routing = null;
    const { live } = (await watch(ctx, P, rideId)).json.data;
    expect(live.eta.source).toBe("estimate");
  });

  it("never changes the quoted fare when the ETA changes", async () => {
    const rideId = await assignedRide(ctx, P, D, 3000);
    const first = await watch(ctx, P, rideId);
    const fare = first.json.data.ride.fareCents;
    ctx.routing.durationSeconds = 1800;
    advanceClock(ctx, ETA.maxAgeSeconds + 1);
    await postLocation(ctx, D, fix(2000, { at: at() }));
    const later = await watch(ctx, P, rideId, {
      version: first.json.data.ride.version - 1,
    });
    expect(later.json.data.live.eta.durationSeconds).toBe(1800);
    expect(later.json.data.ride.fareCents).toBe(fare);
    const { rows } = await db.query(
      "SELECT fare_cents FROM mobility.rides WHERE id = $1",
      [rideId],
    );
    expect(rows[0].fare_cents).toBe(fare);
  });

  it("switches to the destination leg once the trip starts", async () => {
    const rideId = await assignedRide(ctx, P, D, 800);
    await setStatus(ctx, D, rideId, "arriving");
    await setStatus(ctx, D, rideId, "arrived");
    const arrived = (await watch(ctx, P, rideId)).json.data.live;
    expect(arrived.leg).toBe("destination");
    expect(arrived.eta).toBeNull();

    await setStatus(ctx, D, rideId, "in_progress");
    advanceClock(ctx, 5);
    await postLocation(ctx, D, fix(10, { at: at() }));
    const onTrip = (await watch(ctx, P, rideId)).json.data.live;
    expect(onTrip.eta).toMatchObject({ leg: "destination", source: "routed" });
  });

  it("lets only one of several concurrent watchers call the provider", async () => {
    const rideId = await assignedRide(ctx, P, D, 800);
    await Promise.all([
      watch(ctx, P, rideId),
      watch(ctx, P, rideId),
      watch(ctx, D, rideId),
    ]);
    expect(ctx.routing.calls).toHaveLength(1);
  });

  it("sends the route only when it changes", async () => {
    const rideId = await assignedRide(ctx, P, D, 800);
    const first = (await watch(ctx, P, rideId)).json.data.live;
    advanceClock(ctx, 5);
    await postLocation(ctx, D, fix(790, { at: at() }));
    const next = (
      await watch(ctx, P, rideId, { routeVersion: first.routeVersion })
    ).json.data.live;
    expect(next.route).toBeNull();
    expect(next.routeVersion).toBe(first.routeVersion);
  });
});

describe("watch transport", () => {
  it("returns immediately for a new client and when its cursor is behind", async () => {
    const rideId = await assignedRide(ctx, P, D);
    const first = await watch(ctx, P, rideId, { wait: 20 });
    expect(first.json.data.changed).toBe(true);
    expect(first.json.data.ride.status).toBe("accepted");

    const behind = await watch(ctx, P, rideId, { version: 1, wait: 20 });
    expect(behind.json.data.ride.version).toBe(first.json.data.ride.version);
  });

  it("times out with no changes instead of repeating data", async () => {
    const rideId = await assignedRide(ctx, P, D);
    const { ride, live } = (await watch(ctx, P, rideId)).json.data;
    const started = at().getTime();
    const res = await watch(ctx, P, rideId, {
      version: ride.version,
      locationSeq: live.locationSeq,
      wait: 20,
    });
    expect(res.json.data).toMatchObject({
      changed: false,
      ride: null,
      live: null,
    });
    expect(at().getTime() - started).toBeGreaterThanOrEqual(20_000);
  });

  it("wakes up when the other party changes the ride during the wait", async () => {
    const rideId = await assignedRide(ctx, P, D);
    const { ride, live } = (await watch(ctx, P, rideId)).json.data;
    ctx.onSleep = async () => {
      await setStatus(ctx, D, rideId, "arriving");
    };
    const started = at().getTime();
    const res = await watch(ctx, P, rideId, {
      version: ride.version,
      locationSeq: live.locationSeq,
      wait: 20,
    });
    expect(res.json.data.ride.status).toBe("arriving");
    expect(at().getTime() - started).toBeLessThan(5000);
  });

  it("wakes up on a new driver location without a new ride version", async () => {
    const rideId = await assignedRide(ctx, P, D, 800);
    const { ride, live } = (await watch(ctx, P, rideId)).json.data;
    ctx.onSleep = async () => {
      advanceClock(ctx, 5);
      const posted = await postLocation(ctx, D, fix(750, { at: at() }));
      expect(posted.json.data.accepted).toBe(true);
    };
    const res = await watch(ctx, P, rideId, {
      version: ride.version,
      locationSeq: live.locationSeq,
      wait: 20,
    });
    expect(res.json.data.ride).toBeNull();
    expect(res.json.data.live.locationSeq).toBeGreaterThan(live.locationSeq);
  });

  it("recovers every missed change after a reconnect, in one response", async () => {
    const rideId = await assignedRide(ctx, P, D);
    const stale = (await watch(ctx, P, rideId)).json.data.ride.version;
    await setStatus(ctx, D, rideId, "arriving");
    await setStatus(ctx, D, rideId, "arrived");
    const res = await watch(ctx, P, rideId, { version: stale, wait: 20 });
    expect(res.json.data.ride.status).toBe("arrived");
    expect(res.json.data.ride.version).toBeGreaterThan(stale + 1);
  });

  it("rejects a wait longer than the server allows", async () => {
    const rideId = await assignedRide(ctx, P, D);
    const res = await watch(ctx, P, rideId, { wait: 60 });
    expect(res.status).toBe(400);
  });

  it("moves an expiring search forward while a passenger is waiting", async () => {
    const { rideId } = await requestRide(ctx, P);
    const first = (await watch(ctx, P, rideId)).json.data.ride;
    expect(first.status).toBe("requested");
    advanceClock(ctx, 115);
    const res = await watch(ctx, P, rideId, {
      version: first.version,
      wait: 20,
    });
    expect(res.json.data.ride.status).toBe("no_driver");
  });
});
