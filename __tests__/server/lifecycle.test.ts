import {
  allowedActions,
  canTransition,
  TRANSITIONS,
} from "../../server/lifecycle";
import { listRides } from "../../server/routes/rides";
import { rideStatuses } from "../../shared/contracts";

import {
  call,
  createContext,
  resetDb,
  testDb,
  type TestContext,
} from "./helpers";
import {
  assertInvariants,
  assign,
  cancel,
  onlineDriver,
  requestRide,
  setStatus,
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
const D = "user_driver";

describe("transition table", () => {
  it("only lets the driver move the trip forward, one step at a time", () => {
    const chain = [
      "accepted",
      "arriving",
      "arrived",
      "in_progress",
      "completed",
    ] as const;
    for (let i = 0; i < chain.length - 1; i++) {
      expect(canTransition(chain[i], chain[i + 1], "driver")).toBe(true);
      expect(canTransition(chain[i], chain[i + 1], "passenger")).toBe(false);
      for (let j = i + 2; j < chain.length; j++) {
        expect(canTransition(chain[i], chain[j], "driver")).toBe(false);
      }
    }
  });

  it("only lets the system start, offer, or end a search", () => {
    expect(canTransition("awaiting_payment", "requested", "passenger")).toBe(
      false,
    );
    expect(canTransition("awaiting_payment", "requested", "system")).toBe(true);
    expect(canTransition("requested", "offered", "driver")).toBe(false);
    expect(canTransition("requested", "no_driver", "passenger")).toBe(false);
    expect(canTransition("offered", "accepted", "driver")).toBe(true);
    expect(canTransition("requested", "accepted", "driver")).toBe(false);
  });

  it("allows cancelling before the trip starts but not after", () => {
    for (const s of [
      "awaiting_payment",
      "requested",
      "offered",
      "accepted",
      "arriving",
      "arrived",
    ] as const) {
      expect(canTransition(s, "cancelled", "passenger")).toBe(true);
    }
    expect(canTransition("in_progress", "cancelled", "passenger")).toBe(false);
    expect(canTransition("in_progress", "cancelled", "driver")).toBe(false);
    expect(canTransition("requested", "cancelled", "driver")).toBe(false);
  });

  it("treats completed, cancelled, no_driver, and legacy as final", () => {
    for (const s of [
      "completed",
      "cancelled",
      "no_driver",
      "legacy",
    ] as const) {
      expect(TRANSITIONS[s]).toBeUndefined();
      for (const to of rideStatuses) {
        expect(canTransition(s, to, "system")).toBe(false);
      }
    }
  });

  it("derives the actions each viewer sees", () => {
    expect(allowedActions("offered", "passenger")).toEqual(["cancel"]);
    expect(allowedActions("offered", "driver")).toEqual([]);
    expect(allowedActions("accepted", "driver")).toEqual([
      "arriving",
      "cancel",
    ]);
    expect(allowedActions("in_progress", "driver")).toEqual([
      "completed",
      "interrupt",
    ]);
    expect(allowedActions("in_progress", "passenger")).toEqual([]);
  });
});

describe("a full trip", () => {
  it("goes requested → offered → accepted → arriving → arrived → in_progress → completed", async () => {
    await onlineDriver(ctx, D);
    const { rideId, view } = await requestRide(ctx, P);
    expect(view.status).toBe("offered");
    expect(view.paymentStatus).toBe("authorized");
    expect(view.driver).toBeNull();

    await assign(ctx, D, rideId);
    const accepted = (await viewRide(ctx, P, rideId)).json.data;
    expect(accepted.status).toBe("accepted");
    expect(accepted.driver).toMatchObject({
      vehicle: "Toyota Prius",
      seats: 4,
    });
    expect(accepted.driver).not.toHaveProperty("approxLocation");
    expect(accepted.driver).not.toHaveProperty("location");
    expect(accepted.allowedActions).toEqual(["cancel"]);

    let version = accepted.version;
    for (const status of ["arriving", "arrived", "in_progress", "completed"]) {
      const res = await setStatus(ctx, D, rideId, status);
      expect(res.status).toBe(200);
      expect(res.json.data.status).toBe(status);
      expect(res.json.data.version).toBeGreaterThan(version);
      version = res.json.data.version;
    }

    const done = (await viewRide(ctx, P, rideId)).json.data;
    expect(done.status).toBe("completed");
    expect(done.paymentStatus).toBe("paid");
    expect(done.completedAt).not.toBeNull();
    expect(ctx.stripe.calls.capture).toBe(1);

    const { rows } = await db.query(
      "SELECT from_status, to_status, actor FROM mobility.ride_events WHERE ride_id = $1 ORDER BY id",
      [rideId],
    );
    expect(
      rows.map((r) => `${r.from_status}>${r.to_status}:${r.actor}`),
    ).toEqual([
      "awaiting_payment>requested:system",
      "requested>offered:system",
      "offered>accepted:driver",
      "accepted>arriving:driver",
      "arriving>arrived:driver",
      "arrived>in_progress:driver",
      "in_progress>completed:driver",
    ]);
  });

  it("rejects skipped steps and going backwards", async () => {
    await onlineDriver(ctx, D);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);

    const skip = await setStatus(ctx, D, rideId, "completed");
    expect(skip.status).toBe(409);
    expect(skip.json.error.code).toBe("INVALID_TRANSITION");

    await setStatus(ctx, D, rideId, "arriving");
    await setStatus(ctx, D, rideId, "arrived");
    const back = await setStatus(ctx, D, rideId, "arriving");
    expect(back.status).toBe(409);

    const bogus = await setStatus(ctx, D, rideId, "accepted");
    expect(bogus.status).toBe(400);
    expect(ctx.stripe.calls.capture).toBe(0);
  });

  it("treats a repeated status tap as a no-op", async () => {
    await onlineDriver(ctx, D);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);
    const first = await setStatus(ctx, D, rideId, "arriving");
    const again = await setStatus(ctx, D, rideId, "arriving");
    expect(again.status).toBe(200);
    expect(again.json.data.version).toBe(first.json.data.version);
  });

  it("completing twice captures once", async () => {
    await onlineDriver(ctx, D);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);
    for (const s of ["arriving", "arrived", "in_progress"])
      await setStatus(ctx, D, rideId, s);
    const results = await Promise.all([
      setStatus(ctx, D, rideId, "completed"),
      setStatus(ctx, D, rideId, "completed"),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(ctx.stripe.captureKeys.size).toBe(1);
    expect(ctx.stripe.effectiveCaptures).toBe(1);
  });
});

describe("cancellation", () => {
  it("lets the passenger cancel an assigned ride before pickup; the hold is released", async () => {
    await onlineDriver(ctx, D);
    const { rideId, intentId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);
    await setStatus(ctx, D, rideId, "arriving");

    const res = await cancel(ctx, P, rideId);
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      status: "cancelled",
      cancelledBy: "passenger",
      paymentStatus: "cancelled",
    });
    expect(ctx.stripe.intents.get(intentId)!.status).toBe("canceled");

    const driverView = (await viewRide(ctx, D, rideId)).json.data;
    expect(driverView.status).toBe("cancelled");
    expect(driverView.allowedActions).toEqual([]);
  });

  it("sends the ride back to searching when the assigned driver cancels before pickup", async () => {
    await onlineDriver(ctx, D);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);
    const res = await cancel(ctx, D, rideId);
    expect(res.status).toBe(200);
    const passenger = (await viewRide(ctx, P, rideId)).json.data;
    expect(passenger).toMatchObject({
      status: "requested",
      paymentStatus: "authorized",
      rematchCount: 1,
      driver: null,
    });
  });

  it("does not allow cancelling a trip in progress", async () => {
    await onlineDriver(ctx, D);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);
    for (const s of ["arriving", "arrived", "in_progress"])
      await setStatus(ctx, D, rideId, s);
    expect((await cancel(ctx, P, rideId)).status).toBe(409);
    expect((await cancel(ctx, D, rideId)).status).toBe(409);
  });

  it("is idempotent", async () => {
    const { rideId } = await requestRide(ctx, P);
    const [a, b] = await Promise.all([
      cancel(ctx, P, rideId),
      cancel(ctx, P, rideId),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(ctx.stripe.calls.cancel).toBeGreaterThanOrEqual(1);
  });
});

describe("ride history", () => {
  it("distinguishes completed, cancelled, no-driver, and in-progress rides", async () => {
    await onlineDriver(ctx, D);
    const done = await requestRide(ctx, P);
    await assign(ctx, D, done.rideId);
    for (const s of ["arriving", "arrived", "in_progress", "completed"]) {
      await setStatus(ctx, D, done.rideId, s);
    }
    const cancelled = await requestRide(ctx, P);
    await cancel(ctx, P, cancelled.rideId);
    const active = await requestRide(ctx, P);

    const statuses = (await call(ctx, listRides, { user: P })).json.data.map(
      (r: { id: string; status: string }) => [r.id, r.status],
    );
    expect(statuses).toEqual(
      expect.arrayContaining([
        [done.rideId, "completed"],
        [cancelled.rideId, "cancelled"],
        [active.rideId, "offered"],
      ]),
    );
  });

  it("leaves abandoned checkouts (no hold placed) out of history", async () => {
    await requestRide(ctx, P, { authorize: false });
    expect((await call(ctx, listRides, { user: P })).json.data).toEqual([]);
  });
});
