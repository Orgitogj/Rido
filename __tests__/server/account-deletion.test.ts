import { randomUUID } from "node:crypto";

import { sweep } from "../../server/rides";
import { sendChatMessage } from "../../server/routes/chat";
import { putNotificationPreferences } from "../../server/routes/inbox";
import {
  createPlace,
  deleteAccount,
  getAccount,
  getDeletionStatus,
  getPlaces,
  patchAccount,
} from "../../server/routes/profile";
import { rateRide } from "../../server/routes/ratings";
import { listRides } from "../../server/routes/rides";
import { createShare, viewShare } from "../../server/routes/safety";

import {
  call,
  createContext,
  PICKUP,
  resetDb,
  testDb,
  type TestContext,
} from "./helpers";
import {
  advanceClock,
  assertInvariants,
  assign,
  drive,
  goOffline,
  makeOperator,
  onlineDriver,
  registerDevice,
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
const Q = "user_other";
const D = "user_driver";

const remove = (
  user: string,
  factorAgeMinutes: number | undefined = 1,
  body: unknown = { confirm: "DELETE" },
) => call(ctx, deleteAccount, { user, factorAgeMinutes, body });

const status = async (user: string, factorAgeMinutes?: number) =>
  (await call(ctx, getDeletionStatus, { user, factorAgeMinutes })).json.data;

async function history(passenger = P) {
  await onlineDriver(ctx, D);
  const { rideId } = await requestRide(ctx, passenger);
  await assign(ctx, D, rideId);
  await call(ctx, sendChatMessage, {
    user: passenger,
    params: { id: rideId },
    body: { clientMessageId: randomUUID(), body: "I'm at the corner" },
  });
  const share = await call(ctx, createShare, {
    user: passenger,
    params: { id: rideId },
    body: {},
  });
  await drive(ctx, D, rideId);
  await sweep(ctx.deps);
  await call(ctx, rateRide, {
    user: passenger,
    params: { id: rideId },
    body: { stars: 4, comment: "Friendly driver" },
  });
  await goOffline(ctx, D);
  return { rideId, shareToken: share.json.data.token as string };
}

describe("deletion requirements", () => {
  it("needs a recent identity check and an exact confirmation", async () => {
    await call(ctx, getAccount, { user: P });
    expect(await status(P)).toEqual({ blockers: [], reauthRequired: true });
    expect(await status(P, 2)).toEqual({ blockers: [], reauthRequired: false });
    expect((await status(P, 30)).reauthRequired).toBe(true);

    const stale = await call(ctx, deleteAccount, {
      user: P,
      body: { confirm: "DELETE" },
    });
    expect(stale.status).toBe(403);
    expect(stale.json.error.code).toBe("REAUTH_REQUIRED");
    expect((await remove(P, 45)).status).toBe(403);
    expect((await remove(P, 1, { confirm: "delete" })).status).toBe(400);
    expect((await remove(P, 1, {})).status).toBe(400);
    expect((await call(ctx, getAccount, { user: P })).status).toBe(200);
  });

  it("explains what blocks deletion and deletes nothing", async () => {
    await onlineDriver(ctx, D);
    const { rideId } = await requestRide(ctx, P);
    expect((await status(P, 1)).blockers).toEqual(["ACTIVE_RIDE"]);
    const blocked = await remove(P);
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.code).toBe("DELETION_BLOCKED");
    await assign(ctx, D, rideId);
    expect((await status(D, 1)).blockers).toEqual([
      "ACTIVE_DRIVER_RIDE",
      "DRIVER_ONLINE",
    ]);
    expect((await remove(D)).status).toBe(409);
    await makeOperator(ctx, Q, "view");
    expect((await status(Q, 1)).blockers).toEqual(["OPERATOR_ACCOUNT"]);
    expect((await viewRide(ctx, P, rideId)).status).toBe(200);
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.account_deletions",
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("deleting an account", () => {
  it("removes personal data, keeps ride and payment records, and deletes the identity", async () => {
    await call(ctx, patchAccount, {
      method: "PATCH",
      user: P,
      body: { name: "Pat" },
    });
    await call(ctx, createPlace, {
      user: P,
      body: { kind: "home", ...PICKUP },
    });
    await call(ctx, createPlace, {
      user: Q,
      body: { kind: "home", ...PICKUP },
    });
    await registerDevice(ctx, P, "ExponentPushToken[p]");
    await call(ctx, putNotificationPreferences, {
      method: "PUT",
      user: P,
      body: {
        rideUpdates: true,
        chatMessages: false,
        rideOffers: true,
        accountUpdates: true,
      },
    });
    const { rideId } = await history();
    const customer = (
      await db.query<{ stripe_customer_id: string }>(
        "SELECT stripe_customer_id FROM mobility.users WHERE clerk_id = $1",
        [P],
      )
    ).rows[0].stripe_customer_id;

    const res = await remove(P);
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual({ status: "completed" });
    expect(ctx.identity.deleted).toEqual([P]);
    expect(ctx.stripe.deletedCustomers).toEqual([customer]);

    const count = async (sql: string) =>
      (await db.query<{ n: number }>(sql)).rows[0].n;
    const u = "(SELECT user_id FROM mobility.account_deletions)";
    expect(
      await count(
        `SELECT count(*)::int AS n FROM mobility.saved_places WHERE user_id IN ${u}`,
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM mobility.push_tokens WHERE user_id IN ${u}`,
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM mobility.notifications WHERE user_id IN ${u}`,
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM mobility.notification_preferences WHERE user_id IN ${u}`,
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM mobility.ride_messages WHERE sender_user_id IN ${u}`,
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT count(*)::int AS n FROM mobility.trip_shares WHERE revoked_at IS NULL",
      ),
    ).toBe(0);

    const { rows: users } = await db.query(
      `SELECT clerk_id LIKE 'deleted_%' AS tombstone, name, stripe_customer_id, deleted_at IS NOT NULL AS deleted
         FROM mobility.users WHERE id IN ${u}`,
    );
    expect(users).toEqual([
      { tombstone: true, name: null, stripe_customer_id: null, deleted: true },
    ]);
    const { rows: rides } = await db.query(
      "SELECT status, payment_status, fare_cents, captured_cents, passenger_name FROM mobility.rides WHERE id = $1",
      [rideId],
    );
    expect(rides).toEqual([
      {
        status: "completed",
        payment_status: "paid",
        fare_cents: 832,
        captured_cents: 832,
        passenger_name: null,
      },
    ]);
    const { rows: ratings } = await db.query(
      "SELECT stars, comment FROM mobility.ratings",
    );
    expect(ratings).toEqual([{ stars: 4, comment: null }]);
    const { rows: jobs } = await db.query(
      "SELECT clerk_id, completed_at IS NOT NULL AS done, last_error FROM mobility.account_deletions",
    );
    expect(jobs).toEqual([{ clerk_id: null, done: true, last_error: null }]);
    expect(
      await count("SELECT count(*)::int AS n FROM mobility.payment_events"),
    ).toBeGreaterThan(0);

    expect(
      (await call(ctx, getPlaces, { user: Q })).json.data.places,
    ).toHaveLength(1);
    expect((await viewRide(ctx, D, rideId)).json.data.passengerName).toBe(
      "Passenger",
    );
  });

  it("blocks any further use of the deleted identity", async () => {
    await call(ctx, getAccount, { user: P });
    expect((await remove(P)).status).toBe(200);
    for (const attempt of [
      () => call(ctx, getAccount, { user: P }),
      () => call(ctx, listRides, { user: P }),
      () =>
        call(ctx, createPlace, { user: P, body: { kind: "home", ...PICKUP } }),
      () => remove(P),
    ]) {
      const res = await attempt();
      expect(res.status).toBe(403);
      expect(res.json.error.code).toBe("ACCOUNT_DELETED");
    }
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM mobility.users",
    );
    expect(rows[0].n).toBe(1);
  });

  it("retries identity and payment cleanup after failures without reopening the account", async () => {
    await history();
    ctx.identity.fail = true;
    ctx.stripe.customerDeleteFails = true;
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await remove(P);
    expect(res.json.data).toEqual({ status: "pending" });
    expect((await call(ctx, getAccount, { user: P })).status).toBe(403);

    await sweep(ctx.deps);
    let { rows } = await db.query(
      "SELECT attempts, last_error, completed_at FROM mobility.account_deletions",
    );
    expect(rows[0]).toMatchObject({ attempts: 1, completed_at: null });
    expect(rows[0].last_error).toContain("payments");

    ctx.stripe.customerDeleteFails = false;
    advanceClock(ctx, 61);
    await sweep(ctx.deps);
    ({ rows } = await db.query(
      "SELECT payments_deleted_at IS NOT NULL AS paid, identity_deleted_at, last_error FROM mobility.account_deletions",
    ));
    expect(rows[0]).toMatchObject({ paid: true, identity_deleted_at: null });
    expect(rows[0].last_error).toContain("identity");

    ctx.identity.fail = false;
    advanceClock(ctx, 3600);
    await sweep(ctx.deps);
    spy.mockRestore();
    ({ rows } = await db.query(
      "SELECT completed_at IS NOT NULL AS done, clerk_id FROM mobility.account_deletions",
    ));
    expect(rows[0]).toEqual({ done: true, clerk_id: null });
    expect(ctx.identity.deleted).toEqual([P]);
    expect(ctx.stripe.deletedCustomers).toHaveLength(1);
  });

  it("stays pending and says why when identity deletion isn't configured", async () => {
    await call(ctx, getAccount, { user: P });
    ctx.deps.identity = null;
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await remove(P);
    spy.mockRestore();
    expect(res.json.data).toEqual({ status: "pending" });
    const { rows } = await db.query(
      "SELECT last_error FROM mobility.account_deletions",
    );
    expect(rows[0].last_error).toContain("CLERK_SECRET_KEY");
    expect((await call(ctx, getAccount, { user: P })).status).toBe(403);
  });

  it("takes a driver off the road and schedules their documents for removal", async () => {
    await onlineDriver(ctx, D);
    await goOffline(ctx, D);
    const { rows: profile } = await db.query<{ id: string }>(
      "SELECT id FROM mobility.driver_profiles",
    );
    await db.query(
      `INSERT INTO mobility.driver_documents
         (driver_profile_id, kind, status, storage_key, content_type, size_bytes, uploaded_at, created_at, updated_at)
       VALUES ($1, 'identity', 'accepted', 'driver-documents/files/x/y', 'image/png', 400, now(), now(), now())`,
      [profile[0].id],
    );
    ctx.storage.put(
      "driver-documents/files/x/y",
      new Uint8Array(400),
      "image/png",
    );
    expect((await remove(D)).json.data).toEqual({ status: "completed" });
    const { rows } = await db.query(
      "SELECT status, online, display_name, vehicle_plate, deleted_at IS NOT NULL AS deleted FROM mobility.driver_profiles",
    );
    expect(rows).toEqual([
      {
        status: "suspended",
        online: false,
        display_name: "Deleted driver",
        vehicle_plate: "DELETED",
        deleted: true,
      },
    ]);
    await sweep(ctx.deps);
    expect(ctx.storage.objects.size).toBe(0);
    const { rideId } = await requestRide(ctx, P);
    const { rows: offers } = await db.query(
      "SELECT 1 FROM mobility.ride_offers WHERE ride_id = $1",
      [rideId],
    );
    expect(offers).toEqual([]);
  });

  it("makes shared links stop working", async () => {
    const { shareToken: token } = await history();
    expect((await call(ctx, viewShare, { params: { token } })).status).toBe(
      200,
    );
    await remove(P);
    expect((await call(ctx, viewShare, { params: { token } })).status).not.toBe(
      200,
    );
  });
});
