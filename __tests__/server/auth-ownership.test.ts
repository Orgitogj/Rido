import {
  acceptOffer,
  applyToDrive,
  getDriverProfile,
  heartbeat,
  setAvailability,
} from "../../server/routes/driver";
import { runSweep } from "../../server/routes/internal";
import { updateProfile } from "../../server/routes/profile";
import { createQuote } from "../../server/routes/quotes";
import {
  cancelRide,
  createBooking,
  getActiveRide,
  getRide,
  listRides,
  refreshRidePayment,
  updateRideStatus,
} from "../../server/routes/rides";

import {
  call,
  createContext,
  DESTINATION,
  PICKUP,
  resetDb,
  sessionToken,
  testDb,
  type TestContext,
} from "./helpers";
import {
  admin,
  apply,
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
afterAll(() => db.end());

const ALICE = "user_alice";
const BOB = "user_bob";
const DRIVER = "user_driver1";
const OTHER_DRIVER = "user_driver2";

describe("authentication", () => {
  const ID = "00000000-0000-4000-8000-000000000000";
  const endpoints = [
    ["GET /api/rides", listRides, {}],
    ["GET /api/rides/active", getActiveRide, {}],
    ["POST /api/rides", createBooking, { body: { quoteId: ID } }],
    ["GET /api/rides/:id", getRide, { params: { id: ID } }],
    [
      "POST /api/rides/:id/refresh",
      refreshRidePayment,
      { method: "POST", params: { id: ID } },
    ],
    [
      "POST /api/rides/:id/cancel",
      cancelRide,
      { params: { id: ID }, body: {} },
    ],
    [
      "POST /api/rides/:id/status",
      updateRideStatus,
      { params: { id: ID }, body: { status: "arrived" } },
    ],
    [
      "POST /api/quotes",
      createQuote,
      { body: { pickup: PICKUP, destination: DESTINATION } },
    ],
    ["POST /api/user", updateProfile, { body: { name: "Alice" } }],
    ["GET /api/driver/profile", getDriverProfile, {}],
    ["POST /api/driver/heartbeat", heartbeat, { body: {} }],
    [
      "POST /api/driver/availability",
      setAvailability,
      { body: { online: false } },
    ],
    [
      "POST /api/driver/offers/:id/accept",
      acceptOffer,
      { method: "POST", params: { id: ID } },
    ],
  ] as const;

  it.each(endpoints)(
    "%s rejects requests without a bearer token",
    async (_n, handler, opts) => {
      const res = await call(ctx, handler as never, opts as never);
      expect(res.status).toBe(401);
      expect(res.json.error.code).toBe("UNAUTHENTICATED");
    },
  );

  it.each([
    ["malformed header", "Token abc"],
    ["garbage token", "Bearer not.a.jwt"],
    [
      "token signed by another key",
      `Bearer ${sessionToken(ALICE, { signWithOtherKey: true })}`,
    ],
    [
      "expired token",
      `Bearer ${sessionToken(ALICE, { expiresInSeconds: -120 })}`,
    ],
  ])("rejects a %s", async (_n, token) => {
    expect((await call(ctx, listRides, { token })).status).toBe(401);
  });

  it("derives the user from the verified token", async () => {
    const res = await call(ctx, listRides, { user: ALICE });
    expect(res.status).toBe(200);
    const { rows } = await db.query("SELECT clerk_id FROM mobility.users");
    expect(rows).toEqual([{ clerk_id: ALICE }]);
  });

  it("rejects client-supplied identity, price, or status fields", async () => {
    const quote = await call(ctx, createQuote, {
      user: ALICE,
      body: {
        pickup: PICKUP,
        destination: DESTINATION,
        user_id: BOB,
        fareCents: 1,
      },
    });
    expect(quote.status).toBe(400);
    const booking = await call(ctx, createBooking, {
      user: ALICE,
      body: {
        quoteId: "00000000-0000-4000-8000-000000000000",
        payment_status: "paid",
      },
    });
    expect(booking.status).toBe(400);
  });
});

describe("driver role", () => {
  it("cannot be granted from the app: applications always start as drafts", async () => {
    const res = await call(ctx, applyToDrive, {
      user: DRIVER,
      body: {
        displayName: "Dee",
        vehicleMake: "Kia",
        vehicleModel: "Niro",
        vehiclePlate: "ABC 123",
        vehicleSeats: 4,
        status: "approved",
      },
    });
    expect(res.status).toBe(400);

    const ok = await apply(ctx, DRIVER);
    expect(ok.status).toBe(201);
    expect(ok.json.data.status).toBe("draft");
  });

  it("blocks passengers and pending drivers from driver actions", async () => {
    const passenger = await call(ctx, setAvailability, {
      user: ALICE,
      body: { online: true, location: PICKUP_LOCATION },
    });
    expect(passenger.status).toBe(403);
    expect(passenger.json.error.code).toBe("NOT_A_DRIVER");

    await apply(ctx, DRIVER);
    const pending = await call(ctx, setAvailability, {
      user: DRIVER,
      body: { online: true, location: PICKUP_LOCATION },
    });
    expect(pending.status).toBe(403);
    expect(pending.json.error.code).toBe("DRIVER_NOT_APPROVED");

    await admin.setDriverStatus(db, DRIVER, "approved", {
      waiveDocuments: true,
      reason: "test fixture",
    });
    const approved = await call(ctx, setAvailability, {
      user: DRIVER,
      body: { online: true, location: PICKUP_LOCATION },
    });
    expect(approved.status).toBe(200);
    expect(approved.json.data.profile.online).toBe(true);
  });

  it("locks an approved profile against edits from the app", async () => {
    await apply(ctx, DRIVER);
    await admin.setDriverStatus(db, DRIVER, "approved", {
      waiveDocuments: true,
      reason: "test fixture",
    });
    const res = await apply(ctx, DRIVER);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("PROFILE_LOCKED");
  });

  it("suspending a driver takes them offline and blocks driver actions", async () => {
    await onlineDriver(ctx, DRIVER);
    await admin.setDriverStatus(db, DRIVER, "suspended", {
      reason: "test fixture",
    });
    const res = await call(ctx, setAvailability, {
      user: DRIVER,
      body: { online: true, location: PICKUP_LOCATION },
    });
    expect(res.status).toBe(403);
    const { rows } = await db.query(
      "SELECT online FROM mobility.driver_profiles",
    );
    expect(rows[0].online).toBe(false);
  });

  it("requires a location to go online", async () => {
    await apply(ctx, DRIVER);
    await admin.setDriverStatus(db, DRIVER, "approved", {
      waiveDocuments: true,
      reason: "test fixture",
    });
    const res = await call(ctx, setAvailability, {
      user: DRIVER,
      body: { online: true },
    });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("LOCATION_REQUIRED");
  });
});

describe("ownership", () => {
  it("hides a ride from users who are neither its passenger nor its driver", async () => {
    await onlineDriver(ctx, DRIVER);
    const { rideId } = await requestRide(ctx, ALICE);
    await assign(ctx, DRIVER, rideId);

    expect((await viewRide(ctx, ALICE, rideId)).json.data.viewer).toBe(
      "passenger",
    );
    expect((await viewRide(ctx, DRIVER, rideId)).json.data.viewer).toBe(
      "driver",
    );
    expect((await viewRide(ctx, BOB, rideId)).status).toBe(404);
    expect((await cancel(ctx, BOB, rideId)).status).toBe(404);
    expect((await setStatus(ctx, BOB, rideId, "arriving")).status).toBe(404);
  });

  it("does not let another driver act on an assigned ride or someone else's offer", async () => {
    await onlineDriver(ctx, DRIVER, 300);
    await onlineDriver(ctx, OTHER_DRIVER, 900);
    const { rideId } = await requestRide(ctx, ALICE);
    const offerId = (await call(ctx, heartbeat, { user: DRIVER, body: {} }))
      .json.data.offer.id;

    const stolen = await call(ctx, acceptOffer, {
      method: "POST",
      user: OTHER_DRIVER,
      params: { id: offerId },
    });
    expect(stolen.status).toBe(404);

    await call(ctx, acceptOffer, {
      method: "POST",
      user: DRIVER,
      params: { id: offerId },
    });
    expect(
      (await setStatus(ctx, OTHER_DRIVER, rideId, "arriving")).status,
    ).toBe(404);
    expect((await viewRide(ctx, OTHER_DRIVER, rideId)).status).toBe(404);
  });

  it("does not let a passenger change trip status, even on their own ride", async () => {
    await onlineDriver(ctx, DRIVER);
    const { rideId } = await requestRide(ctx, ALICE);
    await assign(ctx, DRIVER, rideId);
    const res = await setStatus(ctx, ALICE, rideId, "completed");
    expect(res.status).toBe(403);
  });

  it("does not let a user book another user's quote", async () => {
    const quote = await call(ctx, createQuote, {
      user: ALICE,
      body: { pickup: PICKUP, destination: DESTINATION },
    });
    const res = await call(ctx, createBooking, {
      user: BOB,
      body: { quoteId: quote.json.data.quote.id },
    });
    expect(res.status).toBe(404);
    expect(ctx.stripe.calls.createIntent).toBe(0);
  });

  it("lists only the caller's own rides", async () => {
    await requestRide(ctx, ALICE);
    expect(
      (await call(ctx, listRides, { user: ALICE })).json.data,
    ).toHaveLength(1);
    expect((await call(ctx, listRides, { user: BOB })).json.data).toEqual([]);
  });

  it("rejects a malformed ride id with 400", async () => {
    expect((await viewRide(ctx, ALICE, "1 OR 1=1")).status).toBe(400);
  });
});

describe("internal sweep", () => {
  it("requires the cron secret", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    const denied = await call(ctx, runSweep, {
      method: "POST",
      token: "Bearer wrong",
    });
    expect(denied.status).toBe(401);
    const ok = await call(ctx, runSweep, {
      method: "POST",
      token: "Bearer test-cron-secret",
    });
    expect(ok.status).toBe(200);
  });
});

const PICKUP_LOCATION = {
  latitude: PICKUP.latitude,
  longitude: PICKUP.longitude,
};
