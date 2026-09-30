import { MATCHING, refreshMatchRanking } from "../../server/matching";
import { sweep } from "../../server/rides";

import {
  createContext,
  pointKey,
  resetDb,
  testDb,
  type TestContext,
} from "./helpers";
import {
  advanceClock,
  assertInvariants,
  dashboard,
  decline,
  goOffline,
  nearPickup,
  onlineDriver,
  requestRide,
  viewRide,
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
const A = "user_driver_a";
const B = "user_driver_b";
const C = "user_driver_c";

const roadTime = (meters: number, seconds: number | null) =>
  ctx.routing.matrixDurations.set(pointKey(nearPickup(meters)), seconds);

async function offers(rideId: string) {
  const { rows } = await db.query<{
    driver: string;
    status: string;
    ranking_source: string;
    road_duration_seconds: number | null;
  }>(
    `SELECT u.clerk_id AS driver, o.status, o.ranking_source, o.road_duration_seconds
       FROM mobility.ride_offers o
       JOIN mobility.driver_profiles dp ON dp.id = o.driver_profile_id
       JOIN mobility.users u ON u.id = dp.user_id
      WHERE o.ride_id = $1 ORDER BY o.created_at, o.id`,
    [rideId],
  );
  return rows;
}

describe("road-based driver ranking", () => {
  it("offers the ride to the driver who can reach the pickup soonest by road", async () => {
    await onlineDriver(ctx, A, 500);
    await onlineDriver(ctx, B, 1500);
    roadTime(500, 900);
    roadTime(1500, 180);
    const { rideId } = await requestRide(ctx, P);
    expect(await offers(rideId)).toEqual([
      {
        driver: B,
        status: "pending",
        ranking_source: "road",
        road_duration_seconds: 180,
      },
    ]);
    expect(ctx.routing.matrixCalls).toHaveLength(1);
    expect(ctx.routing.matrixCalls[0].destination).toMatchObject({
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    });

    const dash = await dashboard(ctx, B);
    await decline(ctx, B, dash.offer!.id);
    expect(
      (await offers(rideId)).map((o) => [o.driver, o.status]).sort(),
    ).toEqual([
      [A, "pending"],
      [B, "declined"],
    ]);
  });

  it("never offers a ride to a driver with no drivable route, and still ends the search on time", async () => {
    await onlineDriver(ctx, A, 300);
    roadTime(300, null);
    const { rideId } = await requestRide(ctx, P);
    expect(await offers(rideId)).toEqual([]);
    advanceClock(ctx, MATCHING.searchTimeoutSeconds + 1);
    await sweep(ctx.deps);
    const { rows } = await db.query(
      "SELECT status FROM mobility.rides WHERE id = $1",
      [rideId],
    );
    expect(rows[0].status).toBe("no_driver");
  });

  it("falls back to straight-line order during a provider outage and backs off before retrying", async () => {
    await onlineDriver(ctx, A, 500);
    await onlineDriver(ctx, B, 1500);
    roadTime(500, 900);
    roadTime(1500, 180);
    ctx.routing.matrixFail = true;
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { rideId } = await requestRide(ctx, P);
    expect(await offers(rideId)).toEqual([
      {
        driver: A,
        status: "pending",
        ranking_source: "straight_line",
        road_duration_seconds: null,
      },
    ]);
    const { rows } = await db.query(
      "SELECT ranking_failures, ranking_retry_at FROM mobility.rides WHERE id = $1",
      [rideId],
    );
    expect(rows[0].ranking_failures).toBe(1);
    expect(new Date(rows[0].ranking_retry_at).getTime()).toBe(
      ctx.clock.now.getTime() + MATCHING.rankingRetryBaseSeconds * 1000,
    );
    await viewRide(ctx, P, rideId);
    await viewRide(ctx, P, rideId);
    expect(ctx.routing.matrixCalls).toHaveLength(1);
    spy.mockRestore();
  });

  it("reuses a fresh ranking and refreshes it only after it ages", async () => {
    await onlineDriver(ctx, A, 500);
    await onlineDriver(ctx, B, 900);
    const { rideId } = await requestRide(ctx, P);
    for (let i = 0; i < 5; i++) await viewRide(ctx, P, rideId);
    expect(ctx.routing.matrixCalls).toHaveLength(1);
    advanceClock(ctx, MATCHING.rankingRefreshSeconds + 1);
    await dashboard(ctx, B);
    expect(ctx.routing.matrixCalls).toHaveLength(2);
    expect(ctx.routing.matrixCalls[1].origins).toHaveLength(1);
  });

  it("sends at most ten drivers to the route matrix", async () => {
    for (let i = 0; i < 12; i++) {
      await onlineDriver(ctx, `user_driver_${i}`, 200 + i * 100);
    }
    await requestRide(ctx, P);
    expect(ctx.routing.matrixCalls).toHaveLength(1);
    expect(ctx.routing.matrixCalls[0].origins).toHaveLength(10);
    expect(ctx.routing.matrixCalls[0].origins[0]).toMatchObject(
      nearPickup(200),
    );
  });

  it("lets only one of several concurrent refreshes call the provider", async () => {
    const { rideId } = await requestRide(ctx, P);
    await onlineDriver(ctx, A, 500);
    await onlineDriver(ctx, B, 900);
    await db.query(
      "UPDATE mobility.rides SET ranking_computed_at = NULL WHERE id = $1",
      [rideId],
    );
    ctx.routing.matrixCalls.length = 0;
    const outcomes = await Promise.all([
      refreshMatchRanking(ctx.deps, rideId),
      refreshMatchRanking(ctx.deps, rideId),
      refreshMatchRanking(ctx.deps, rideId),
    ]);
    expect(outcomes.filter((o) => o === "ranked")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "skipped")).toHaveLength(2);
    expect(ctx.routing.matrixCalls).toHaveLength(1);
  });

  it("never offers to a ranked driver who stopped being available", async () => {
    await onlineDriver(ctx, A, 500);
    await onlineDriver(ctx, B, 1500);
    await onlineDriver(ctx, C, 2500);
    roadTime(500, 120);
    roadTime(1500, 240);
    roadTime(2500, 360);
    const { rideId } = await requestRide(ctx, P);
    expect((await offers(rideId))[0].driver).toBe(A);
    await goOffline(ctx, A);
    await goOffline(ctx, B);
    await viewRide(ctx, P, rideId);
    const list = await offers(rideId);
    expect(list.map((o) => [o.driver, o.status]).sort()).toEqual([
      [A, "cancelled"],
      [B, "cancelled"],
      [C, "pending"],
    ]);
    expect(list.every((o) => o.ranking_source === "road")).toBe(true);
  });

  it("uses straight-line order when the matrix budget is exhausted", async () => {
    await onlineDriver(ctx, A, 500);
    await onlineDriver(ctx, B, 1500);
    roadTime(500, 900);
    roadTime(1500, 180);
    const minute = new Date(ctx.clock.now);
    minute.setUTCSeconds(0, 0);
    await db.query(
      "INSERT INTO mobility.routing_usage (api, minute, units) VALUES ('route_matrix', $1, 300)",
      [minute],
    );
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { rideId } = await requestRide(ctx, P);
    spy.mockRestore();
    expect(ctx.routing.matrixCalls).toHaveLength(0);
    expect((await offers(rideId))[0]).toMatchObject({
      driver: A,
      ranking_source: "straight_line",
    });
  });

  it("still matches without a routing provider", async () => {
    await onlineDriver(ctx, A, 500);
    const { rideId } = await requestRide(ctx, P);
    ctx.deps.routing = null;
    await dashboard(ctx, A);
    expect(await refreshMatchRanking(ctx.deps, rideId)).toBe("no_routing");
    expect((await offers(rideId))[0].driver).toBe(A);
  });
});
