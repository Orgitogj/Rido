import { checkReceipts, deliverPending } from "../../server/notifications";
import { unregisterDevice } from "../../server/routes/devices";

import {
  call,
  createContext,
  resetDb,
  testDb,
  type TestContext,
} from "./helpers";
import {
  advanceClock,
  assertInvariants,
  assign,
  cancel,
  dashboard,
  fix,
  onlineDriver,
  postLocation,
  registerDevice,
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
const PHONE_P = "ExponentPushToken[passenger-phone]";
const PHONE_D = "ExponentPushToken[driver-phone]";
const at = () => ctx.clock.now;

const kinds = (token: string) => ctx.push.to(token).map((m) => m.data.kind);

async function setup() {
  await registerDevice(ctx, P, PHONE_P);
  await registerDevice(ctx, D, PHONE_D);
  await onlineDriver(ctx, D);
}

describe("who is notified", () => {
  it("tells the driver about a new offer and the passenger about each trip step", async () => {
    await setup();
    const { rideId } = await requestRide(ctx, P);
    expect(kinds(PHONE_D)).toEqual(["offer"]);
    expect(ctx.push.to(PHONE_D)[0]).toMatchObject({
      title: "New ride request",
      data: { target: "/driver", recipient: D },
    });

    await assign(ctx, D, rideId);
    for (const s of ["arriving", "arrived", "in_progress", "completed"]) {
      await setStatus(ctx, D, rideId, s);
    }
    expect(kinds(PHONE_P)).toEqual([
      "ride_accepted",
      "ride_arrived",
      "ride_started",
      "ride_completed",
    ]);
    for (const m of ctx.push.to(PHONE_P)) {
      expect(m.data).toMatchObject({
        rideId,
        target: `/ride/${rideId}`,
        recipient: P,
      });
    }
    expect(kinds(PHONE_D)).toEqual(["offer"]);
  });

  it("tells the other party when a ride is cancelled", async () => {
    await setup();
    const first = await requestRide(ctx, P);
    await assign(ctx, D, first.rideId);
    await cancel(ctx, P, first.rideId);
    expect(kinds(PHONE_D)).toContain("ride_cancelled");
    expect(kinds(PHONE_P)).not.toContain("ride_cancelled");

    const second = await requestRide(ctx, P);
    await assign(ctx, D, second.rideId);
    await cancel(ctx, D, second.rideId);
    expect(kinds(PHONE_P)).toContain("ride_rematching");
    expect(kinds(PHONE_P)).not.toContain("ride_cancelled");
  });

  it("tells the passenger when no driver was found", async () => {
    await registerDevice(ctx, P, PHONE_P);
    const { rideId } = await requestRide(ctx, P);
    advanceClock(ctx, 121);
    await viewRide(ctx, P, rideId);
    expect(kinds(PHONE_P)).toEqual(["no_driver", "hold_released"]);
    const [noDriver, released] = ctx.push.to(PHONE_P);
    expect(noDriver.body).not.toMatch(/not charged/i);
    expect(released.body).toMatch(/released/);
  });

  it("does not send a push for location updates", async () => {
    await setup();
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);
    const before = ctx.push.sent.length;
    for (let i = 1; i <= 5; i++) {
      advanceClock(ctx, 5);
      await postLocation(ctx, D, fix(500 - i * 30, { at: at() }));
    }
    expect(ctx.push.sent.length).toBe(before);
  });
});

describe("deduplication and delivery", () => {
  it("sends each event once, even with duplicate taps and concurrent deliverers", async () => {
    await setup();
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);
    await Promise.all([
      setStatus(ctx, D, rideId, "arriving"),
      setStatus(ctx, D, rideId, "arriving"),
    ]);
    await setStatus(ctx, D, rideId, "arrived");
    await setStatus(ctx, D, rideId, "arrived");
    await Promise.all([deliverPending(ctx.deps), deliverPending(ctx.deps)]);
    expect(kinds(PHONE_P).filter((k) => k === "ride_arrived")).toHaveLength(1);
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.notifications WHERE kind = 'ride_arrived'",
    );
    expect(rows[0].n).toBe(1);
  });

  it("retries after a push service outage without duplicating", async () => {
    await setup();
    ctx.push.down = true;
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await requestRide(ctx, P);
    errorSpy.mockRestore();
    expect(kinds(PHONE_D)).toEqual([]);
    ctx.push.down = false;
    await deliverPending(ctx.deps);
    await deliverPending(ctx.deps);
    expect(kinds(PHONE_D)).toEqual(["offer"]);
  });

  it("drops an offer notification that is already past the offer's lifetime", async () => {
    await setup();
    ctx.push.down = true;
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await requestRide(ctx, P);
    errorSpy.mockRestore();
    ctx.push.down = false;
    advanceClock(ctx, 30);
    await deliverPending(ctx.deps);
    expect(kinds(PHONE_D)).toEqual([]);
    const { rows } = await db.query(
      "SELECT status, last_error FROM mobility.notifications WHERE kind = 'offer'",
    );
    expect(rows[0]).toEqual({ status: "skipped", last_error: "expired" });
  });

  it("skips users without a registered device", async () => {
    await onlineDriver(ctx, D);
    await requestRide(ctx, P);
    const { rows } = await db.query(
      "SELECT status, last_error FROM mobility.notifications WHERE kind = 'offer'",
    );
    expect(rows[0]).toEqual({ status: "skipped", last_error: "no_device" });
  });
});

describe("device tokens", () => {
  it("rejects malformed tokens", async () => {
    const res = await registerDevice(ctx, P, "not-a-push-token");
    expect(res.status).toBe(400);
  });

  it("disables a token Expo reports as no longer registered", async () => {
    await setup();
    ctx.push.expiredTokens.add(PHONE_D);
    await requestRide(ctx, P);
    const { rows } = await db.query(
      "SELECT disabled_reason FROM mobility.push_tokens WHERE token = $1",
      [PHONE_D],
    );
    expect(rows[0].disabled_reason).toBe("DeviceNotRegistered");
  });

  it("disables a token from a delayed receipt error", async () => {
    await setup();
    await requestRide(ctx, P);
    const { rows: tickets } = await db.query(
      "SELECT ticket_id FROM mobility.push_tickets",
    );
    ctx.push.receiptErrors.set(tickets[0].ticket_id, "DeviceNotRegistered");
    advanceClock(ctx, 16 * 60);
    await checkReceipts(ctx.deps);
    const { rows } = await db.query(
      "SELECT disabled_reason FROM mobility.push_tokens WHERE token = $1",
      [PHONE_D],
    );
    expect(rows[0].disabled_reason).toBe("DeviceNotRegistered");
  });

  it("moves a device to the account that signed in on it", async () => {
    await registerDevice(ctx, "user_first_account", PHONE_P);
    await registerDevice(ctx, P, PHONE_P);
    await onlineDriver(ctx, D);
    await registerDevice(ctx, D, PHONE_D);
    const { rideId } = await requestRide(ctx, P);
    await assign(ctx, D, rideId);
    const { rows } = await db.query(
      `SELECT u.clerk_id FROM mobility.push_tokens t
         JOIN mobility.users u ON u.id = t.user_id WHERE t.token = $1`,
      [PHONE_P],
    );
    expect(rows).toEqual([{ clerk_id: P }]);
    expect(ctx.push.to(PHONE_P).every((m) => m.data.recipient === P)).toBe(
      true,
    );
  });

  it("stops notifying a device after sign-out, and ignores other users' tokens", async () => {
    await setup();
    const stranger = await call(ctx, unregisterDevice, {
      user: "user_stranger",
      body: { token: PHONE_D },
    });
    expect(stranger.status).toBe(200);
    const stillActive = await db.query(
      "SELECT disabled_at FROM mobility.push_tokens WHERE token = $1",
      [PHONE_D],
    );
    expect(stillActive.rows[0].disabled_at).toBeNull();

    await call(ctx, unregisterDevice, { user: D, body: { token: PHONE_D } });
    await requestRide(ctx, P);
    expect(kinds(PHONE_D)).toEqual([]);
    expect((await dashboard(ctx, D)).offer).not.toBeNull();
  });
});
