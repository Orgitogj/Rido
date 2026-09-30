import * as admin from "../../scripts/admin-lib.cjs";
import { registerDevice as registerDeviceHandler } from "../../server/routes/devices";
import {
  acceptOffer,
  applyToDrive,
  declineOffer,
  heartbeat,
  setAvailability,
} from "../../server/routes/driver";
import { updateDriverLocation } from "../../server/routes/location";
import { createQuote } from "../../server/routes/quotes";
import { getReceipt, listReceipts } from "../../server/routes/receipts";
import {
  cancelRide,
  createBooking,
  getRide,
  interruptRide,
  listRides,
  refreshRidePayment,
  updateRideStatus,
} from "../../server/routes/rides";
import { watchRide } from "../../server/routes/watch";

import { call, DESTINATION, PICKUP, type TestContext } from "./helpers";

import type { Handler } from "../../server/http";
import type { DriverDashboard, RideView } from "../../shared/contracts";

export { admin };

export const nearPickup = (meters: number) => ({
  latitude: PICKUP.latitude + meters / 111_320,
  longitude: PICKUP.longitude,
});

export async function apply(ctx: TestContext, clerkId: string) {
  return call(ctx, applyToDrive, {
    user: clerkId,
    body: {
      displayName: `Driver ${clerkId}`,
      vehicleMake: "Toyota",
      vehicleModel: "Prius",
      vehiclePlate: clerkId
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(-8)
        .toUpperCase(),
      vehicleSeats: 4,
      vehicleColor: "Silver",
    },
  });
}

export async function onlineDriver(
  ctx: TestContext,
  clerkId: string,
  metersFromPickup = 500,
) {
  expect((await apply(ctx, clerkId)).status).toBe(201);
  await admin.setDriverStatus(ctx.db, clerkId, "approved", {
    waiveDocuments: true,
    reason: "test fixture",
  });
  const res = await goOnline(ctx, clerkId, metersFromPickup);
  expect(res.status).toBe(200);
}

export const goOnline = (
  ctx: TestContext,
  clerkId: string,
  metersFromPickup = 500,
) =>
  call(ctx, setAvailability, {
    user: clerkId,
    body: { online: true, location: nearPickup(metersFromPickup) },
  });

export const goOffline = (ctx: TestContext, clerkId: string) =>
  call(ctx, setAvailability, { user: clerkId, body: { online: false } });

export async function dashboard(ctx: TestContext, clerkId: string) {
  const res = await call(ctx, heartbeat, { user: clerkId, body: {} });
  expect(res.status).toBe(200);
  return res.json.data as DriverDashboard;
}

export async function requestRide(
  ctx: TestContext,
  passenger: string,
  { authorize = true } = {},
) {
  const quote = await call(ctx, createQuote, {
    user: passenger,
    body: { pickup: PICKUP, destination: DESTINATION },
  });
  expect(quote.status).toBe(201);
  ctx.routing.calls.length = 0;
  const booking = await call(ctx, createBooking, {
    user: passenger,
    body: { quoteId: quote.json.data.quote.id },
  });
  expect(booking.status).toBe(201);
  const rideId: string = booking.json.data.rideId;
  const intentId = [...ctx.stripe.intents.values()].find(
    (i) => i.metadata.ride_id === rideId,
  )!.id;
  if (authorize) ctx.stripe.authorize(intentId);
  const view = await refresh(ctx, passenger, rideId);
  return {
    rideId,
    intentId,
    quoteId: quote.json.data.quote.id as string,
    view,
  };
}

export async function refresh(ctx: TestContext, user: string, rideId: string) {
  const res = await call(ctx, refreshRidePayment, {
    method: "POST",
    user,
    params: { id: rideId },
  });
  expect(res.status).toBe(200);
  return res.json.data as RideView;
}

export const viewRide = (ctx: TestContext, user: string, rideId: string) =>
  call(ctx, getRide, { user, params: { id: rideId } });

export const accept = (ctx: TestContext, driver: string, offerId: string) =>
  call(ctx, acceptOffer, {
    method: "POST",
    user: driver,
    params: { id: offerId },
  });

export const decline = (ctx: TestContext, driver: string, offerId: string) =>
  call(ctx, declineOffer, {
    method: "POST",
    user: driver,
    params: { id: offerId },
  });

export const cancel = (ctx: TestContext, user: string, rideId: string) =>
  call(ctx, cancelRide, { user, params: { id: rideId }, body: {} });

export const setStatus = (
  ctx: TestContext,
  user: string,
  rideId: string,
  status: string,
) =>
  call(ctx, updateRideStatus, {
    user,
    params: { id: rideId },
    body: { status },
  });

export async function assign(ctx: TestContext, driver: string, rideId: string) {
  const dash = await dashboard(ctx, driver);
  expect(dash.offer?.rideId).toBe(rideId);
  const res = await accept(ctx, driver, dash.offer!.id);
  expect(res.status).toBe(200);
  return dash.offer!.id;
}

export const advanceClock = (ctx: TestContext, seconds: number) => {
  ctx.clock.now = new Date(ctx.clock.now.getTime() + seconds * 1000);
};

export async function assertInvariants(ctx: TestContext) {
  const { rows } = await ctx.db.query<{ id: string; problem: string }>(`
    SELECT id, 'paid but not completed' AS problem FROM mobility.rides
     WHERE payment_status = 'paid' AND status NOT IN ('completed', 'legacy')
    UNION ALL
    SELECT id, 'searching/assigned without a hold' FROM mobility.rides
     WHERE status IN ('requested','offered','accepted','arriving','arrived','in_progress')
       AND payment_status <> 'authorized'
    UNION ALL
    SELECT id, 'ended with hold not released' FROM mobility.rides
     WHERE status IN ('cancelled','no_driver','interrupted') AND payment_status = 'authorized'
       AND settlement_attempts = 0
    UNION ALL
    SELECT id, 'paid without a captured amount' FROM mobility.rides
     WHERE payment_status = 'paid' AND captured_cents IS NULL AND status <> 'legacy'
    UNION ALL
    SELECT id, 'refunded more than captured' FROM mobility.rides
     WHERE refunded_cents > COALESCE(captured_cents, 0) AND status <> 'legacy'
    UNION ALL
    SELECT id, 're-matched beyond the limit' FROM mobility.rides WHERE rematch_count > 2
    UNION ALL
    SELECT ride_id, 'more than one accepted offer' FROM mobility.ride_offers
     WHERE status = 'accepted' GROUP BY ride_id HAVING count(*) > 1
    UNION ALL
    SELECT r.id, 'assigned driver differs from accepted offer' FROM mobility.rides r
      JOIN mobility.ride_offers o ON o.ride_id = r.id AND o.status = 'accepted'
     WHERE r.driver_profile_id IS DISTINCT FROM o.driver_profile_id
  `);
  expect(rows).toEqual([]);
}

export const fix = (
  meters: number,
  opts: { secondsAgo?: number; accuracy?: number | null; at?: Date } = {},
) => ({
  ...nearPickup(meters),
  accuracy: opts.accuracy === undefined ? 10 : opts.accuracy,
  heading: null,
  speed: null,
  recordedAt: new Date(
    (opts.at ?? new Date()).getTime() - (opts.secondsAgo ?? 0) * 1000,
  ).toISOString(),
});

export async function postLocation(
  ctx: TestContext,
  driver: string,
  body: ReturnType<typeof fix>,
) {
  const res = await call(ctx, updateDriverLocation, { user: driver, body });
  return res;
}

export async function watch(
  ctx: TestContext,
  user: string,
  rideId: string,
  query: Record<string, number> = {},
) {
  const qs = new URLSearchParams(
    Object.entries({ wait: 0, ...query }).map(([k, v]) => [k, String(v)]),
  );
  const res = await call(ctx, watchRide, {
    user,
    params: { id: rideId },
    url: `http://localhost/api/rides/${rideId}/watch?${qs}`,
  });
  return res;
}

export const registerDevice = (ctx: TestContext, user: string, token: string) =>
  call(ctx, registerDeviceHandler, {
    user,
    body: { token, platform: "android" },
  });

export async function assignedRide(
  ctx: TestContext,
  passenger: string,
  driver: string,
  metersFromPickup = 800,
) {
  await onlineDriver(ctx, driver, metersFromPickup);
  const { rideId } = await requestRide(ctx, passenger);
  await assign(ctx, driver, rideId);
  return rideId;
}

export const interrupt = (
  ctx: TestContext,
  user: string,
  rideId: string,
  reason = "vehicle_problem",
) =>
  call(ctx, interruptRide, { user, params: { id: rideId }, body: { reason } });

export const receipt = (ctx: TestContext, user: string, rideId: string) =>
  call(ctx, getReceipt, { user, params: { id: rideId } });

export const receipts = (ctx: TestContext, user: string) =>
  call(ctx, listReceipts, { user });

export async function drive(
  ctx: TestContext,
  driver: string,
  rideId: string,
  until: "arriving" | "arrived" | "in_progress" | "completed" = "completed",
) {
  for (const s of ["arriving", "arrived", "in_progress", "completed"]) {
    const res = await setStatus(ctx, driver, rideId, s);
    expect(res.status).toBe(200);
    if (s === until) return;
  }
}

export async function makeOperator(
  ctx: TestContext,
  clerkId: string,
  permissions = "view,support,refund",
) {
  await call(ctx, listRides, { user: clerkId });
  return admin.grantOperator(ctx.db, {
    clerkId,
    displayName: `Op ${clerkId}`,
    permissions,
    grantedBy: "test-runner",
  });
}

export const adminGet = <P>(
  ctx: TestContext,
  user: string,
  handler: Handler<P>,
  opts: { params?: P; query?: Record<string, string | number> } = {},
) =>
  call(ctx, handler, {
    user,
    params: opts.params,
    url: `http://localhost/api/admin?${new URLSearchParams(
      Object.entries(opts.query ?? {}).map(([k, v]) => [k, String(v)]),
    )}`,
  });

export const adminPost = <P>(
  ctx: TestContext,
  user: string,
  handler: Handler<P>,
  params: P,
  body: unknown,
) => call(ctx, handler, { user, params, body });
