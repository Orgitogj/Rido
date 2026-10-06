import { historyQuerySchema } from "../../shared/account";
import {
  type BookingResponse,
  bookingRequestSchema,
  cancelRequestSchema,
  driverStatusRequestSchema,
  interruptRequestSchema,
  rideIdSchema,
  stopReachedSchema,
} from "../../shared/contracts";
import { asCurrency } from "../../shared/currency";
import { driverCancel, interruptTrip, passengerCancel } from "../cancellation";
import { assertNoUnpaidRide } from "../collection";
import { ApiError, notFound } from "../errors";
import { type Deps, parseInput, readJson } from "../http";
import { ACTIVE_STATUSES, type RideRow, transitionRide } from "../lifecycle";
import { paymentMode } from "../paymentMode";
import { checkTripPin } from "../pin";
import { startSearchWithoutPayment } from "../rides";
import {
  advanceRideById,
  rideView,
  rideViews,
  settlePayment,
  syncIntent,
  withLockedRide,
} from "../rides";
import { type AppUser, ensureUser } from "../users";

import { decodeCursor, encodeCursor } from "./admin";

import type { Page, RideView } from "../../shared/contracts";

type Viewer = "passenger" | "driver";

const forbidden = (message: string) => new ApiError(403, "FORBIDDEN", message);

export async function resolveViewer(
  deps: Deps,
  user: AppUser,
  rawId: string | undefined,
): Promise<{ rideId: string; viewer: Viewer; driverProfileId: string | null }> {
  const rideId = parseInput(rideIdSchema, rawId);
  const { rows } = await deps.db.query<{
    user_id: string;
    driver_user_id: string | null;
    driver_profile_id: string | null;
  }>(
    `SELECT r.user_id, dp.user_id AS driver_user_id, r.driver_profile_id
       FROM mobility.rides r
       LEFT JOIN mobility.driver_profiles dp ON dp.id = r.driver_profile_id
      WHERE r.id = $1`,
    [rideId],
  );
  const row = rows[0];
  if (row?.user_id === user.id) {
    return { rideId, viewer: "passenger", driverProfileId: null };
  }
  if (row && row.driver_user_id === user.id) {
    return { rideId, viewer: "driver", driverProfileId: row.driver_profile_id };
  }
  throw notFound("Ride");
}

export async function currentUser(request: Request, deps: Deps) {
  const identity = await deps.authenticate(request);
  return ensureUser(deps.db, identity);
}

export async function listRides(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const views = await rideViews(
    deps.db,
    "r.user_id = $1 AND (r.requested_at IS NOT NULL OR r.status = 'legacy')",
    [user.id],
    "passenger",
    deps.now(),
    "ORDER BY r.created_at DESC, r.id DESC LIMIT 50",
  );
  return Response.json({ data: views });
}

export async function listRideHistory(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const q = parseInput(
    historyQuerySchema,
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const cursor = decodeCursor(q.cursor);
  const views = await rideViews(
    deps.db,
    `r.user_id = $1 AND (r.requested_at IS NOT NULL OR r.status = 'legacy')
       AND ($2::timestamptz IS NULL OR (r.created_at, r.id) < ($2::timestamptz, $3::uuid))`,
    [user.id, cursor?.[0] ?? null, cursor?.[1] ?? null],
    "passenger",
    deps.now(),
    `ORDER BY r.created_at DESC, r.id DESC LIMIT ${q.limit + 1}`,
  );
  const more = views.length > q.limit;
  const items = more ? views.slice(0, q.limit) : views;
  const last = items[items.length - 1];
  const body: Page<RideView> = {
    items,
    nextCursor:
      more && last ? encodeCursor(new Date(last.createdAt), last.id) : null,
  };
  return Response.json({ data: body });
}

export async function getActiveRide(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const { rows } = await deps.db.query<{ id: string }>(
    `SELECT id FROM mobility.rides
      WHERE user_id = $1 AND status = ANY($2::text[])
      ORDER BY created_at DESC LIMIT 1`,
    [user.id, ACTIVE_STATUSES],
  );
  if (!rows[0]) return Response.json({ data: null });
  await advanceRideById(deps, rows[0].id);
  return Response.json({
    data: await rideView(deps.db, rows[0].id, "passenger", deps.now()),
  });
}

export async function getRide(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const { rideId, viewer } = await resolveViewer(deps, user, params.id);
  await advanceRideById(deps, rideId);
  return Response.json({
    data: await rideView(deps.db, rideId, viewer, deps.now()),
  });
}

export async function refreshRidePayment(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const { rideId, viewer } = await resolveViewer(deps, user, params.id);
  if (viewer !== "passenger") {
    throw forbidden("Only the passenger can refresh this payment.");
  }
  const { rows } = await deps.db.query<{
    stripe_payment_intent_id: string | null;
  }>("SELECT stripe_payment_intent_id FROM mobility.rides WHERE id = $1", [
    rideId,
  ]);
  const pi = rows[0].stripe_payment_intent_id;
  if (pi) {
    await syncIntent(
      deps,
      rideId,
      await deps.payments.retrievePaymentIntent(pi),
    );
  }
  await advanceRideById(deps, rideId);
  return Response.json({
    data: await rideView(deps.db, rideId, "passenger", deps.now()),
  });
}

export async function cancelRide(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const { rideId, viewer } = await resolveViewer(deps, user, params.id);
  const { reason } = await readJson(request, cancelRequestSchema);

  const ride = await withLockedRide(deps, rideId, (tx, ride) =>
    viewer === "passenger"
      ? passengerCancel(tx, ride, user.id, deps.now(), reason)
      : driverCancel(tx, ride, user.id, deps.now(), reason),
  );
  await settlePayment(deps, ride, { force: true });
  const stillAssigned = viewer === "driver" && ride.driver_profile_id !== null;
  return Response.json({
    data:
      stillAssigned || viewer === "passenger"
        ? await rideView(deps.db, rideId, viewer, deps.now())
        : null,
  });
}

export async function updateRideStatus(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const { rideId, viewer, driverProfileId } = await resolveViewer(
    deps,
    user,
    params.id,
  );
  if (viewer !== "driver") {
    throw forbidden("Only the assigned driver can update the trip status.");
  }
  const { status, pin } = await readJson(request, driverStatusRequestSchema);

  const outcome = await withLockedRide(
    deps,
    rideId,
    async (tx, ride): Promise<{ ride: RideRow; error?: ApiError }> => {
      if (ride.driver_profile_id !== driverProfileId) throw notFound("Ride");
      if (ride.status === status) return { ride };
      const now = deps.now();
      let pinVerified = false;
      if (status === "in_progress" && ride.status === "arrived") {
        const check = await checkTripPin(tx, ride, pin, now);
        if (!check.ok) return { ride: check.ride, error: check.error };
        pinVerified = check.verified;
      }
      return {
        ride: await transitionRide(tx, ride, status, {
          actor: "driver",
          actorUserId: user.id,
          now,
          pinVerified,
        }),
      };
    },
  );
  if (outcome.error) throw outcome.error;
  const ride = outcome.ride;
  await settlePayment(deps, ride, { force: true });
  return Response.json({
    data: await rideView(deps.db, rideId, "driver", deps.now()),
  });
}

export async function ensureStripeCustomer(
  deps: Deps,
  user: AppUser,
): Promise<string> {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const customer = await deps.payments.createCustomer(
    { userId: user.id, clerkId: user.clerk_id },
    `customer-${user.id}`,
  );
  const { rows } = await deps.db.query<{ stripe_customer_id: string }>(
    `UPDATE mobility.users
        SET stripe_customer_id = COALESCE(stripe_customer_id, $2), updated_at = now()
      WHERE id = $1 RETURNING stripe_customer_id`,
    [user.id, customer.id],
  );
  return rows[0].stripe_customer_id;
}

export async function createBooking(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const { quoteId } = await readJson(request, bookingRequestSchema);

  const quote = await deps.db.query<{ id: string }>(
    "SELECT id FROM mobility.quotes WHERE id = $1 AND user_id = $2",
    [quoteId, user.id],
  );
  if (!quote.rows[0]) throw notFound("Quote");
  await assertNoUnpaidRide(deps.db, user.id);

  const active = await deps.db.query<{ id: string }>(
    `SELECT id FROM mobility.rides
      WHERE user_id = $1 AND status = ANY($2::text[]) AND quote_id <> $3`,
    [user.id, ACTIVE_STATUSES, quoteId],
  );
  if (active.rows[0]) {
    throw new ApiError(
      409,
      "ACTIVE_RIDE_EXISTS",
      "You already have a ride in progress.",
    );
  }

  const inserted = await deps.db.query<RideRow>(
    `INSERT INTO mobility.rides (
       quote_id, user_id,
       origin_address, origin_latitude, origin_longitude,
       destination_address, destination_latitude, destination_longitude,
       distance_meters, duration_seconds, fare_cents, currency, created_at,
       pricing_version, service_area_id, fare_policy_id, route_source, passenger_name,
       stops, vehicle_category_id, vehicle_category_name, passenger_count, payment_method)
     SELECT q.id, q.user_id,
            q.pickup_address, q.pickup_latitude, q.pickup_longitude,
            q.destination_address, q.destination_latitude, q.destination_longitude,
            q.distance_meters, q.duration_seconds, q.fare_cents, q.currency, $2,
            q.pricing_version, q.service_area_id, q.fare_policy_id, q.route_source,
            (SELECT u.name FROM mobility.users u WHERE u.id = q.user_id),
            q.stops, q.vehicle_category_id, q.vehicle_category_name, q.passenger_count, $3
       FROM mobility.quotes q
      WHERE q.id = $1 AND q.expires_at > $2
        AND (q.service_area_id IS NULL OR EXISTS (
              SELECT 1 FROM mobility.service_areas a
               WHERE a.id = q.service_area_id AND a.status = 'active'))
        AND (q.vehicle_category_id IS NULL OR EXISTS (
              SELECT 1 FROM mobility.vehicle_categories c
               WHERE c.id = q.vehicle_category_id AND c.status = 'active'))
     ON CONFLICT (quote_id) DO NOTHING
     RETURNING *`,
    [quoteId, deps.now(), paymentMode()],
  );
  let ride = inserted.rows[0];
  const created = Boolean(ride);
  if (!ride) {
    const existing = await deps.db.query<RideRow>(
      "SELECT * FROM mobility.rides WHERE quote_id = $1 AND user_id = $2",
      [quoteId, user.id],
    );
    ride = existing.rows[0];
    if (!ride) {
      const { rows: closed } = await deps.db.query<{
        inactive: boolean;
        category_inactive: boolean;
      }>(
        `SELECT a.status <> 'active' AS inactive,
                COALESCE(c.status <> 'active', false) AS category_inactive
           FROM mobility.quotes q
           JOIN mobility.service_areas a ON a.id = q.service_area_id
           LEFT JOIN mobility.vehicle_categories c ON c.id = q.vehicle_category_id
          WHERE q.id = $1 AND q.expires_at > $2`,
        [quoteId, deps.now()],
      );
      if (closed[0]?.category_inactive && !closed[0].inactive) {
        throw new ApiError(
          409,
          "CATEGORY_UNAVAILABLE",
          "This vehicle category is no longer available. Please get a new price.",
        );
      }
      if (closed[0]?.inactive) {
        throw new ApiError(
          409,
          "SERVICE_AREA_UNAVAILABLE",
          "Rides are no longer available in this area. Please try again later.",
        );
      }
      throw new ApiError(
        410,
        "QUOTE_EXPIRED",
        "This price has expired. Please get a new quote.",
      );
    }
  }

  if (ride.payment_method === "in_vehicle") {
    const started = await startSearchWithoutPayment(deps, ride.id);
    const direct: BookingResponse = {
      paymentMethod: "in_vehicle",
      rideId: started.id,
      fareCents: started.fare_cents,
      currency: asCurrency(started.currency),
      status: started.status,
    };
    return Response.json({ data: direct }, { status: created ? 201 : 200 });
  }
  const customerId = await ensureStripeCustomer(deps, user);

  let intent;
  if (ride.stripe_payment_intent_id) {
    intent = await deps.payments.retrievePaymentIntent(
      ride.stripe_payment_intent_id,
    );
    ride = await syncIntent(deps, ride.id, intent);
  } else {
    intent = await deps.payments.createPaymentIntent(
      {
        amount: ride.fare_cents,
        currency: asCurrency(ride.currency),
        customer: customerId,
        metadata: { ride_id: ride.id, app_user_id: user.id },
      },
      `ride-${ride.id}-intent`,
    );
    const linked = await deps.db.query<{ stripe_payment_intent_id: string }>(
      `UPDATE mobility.rides
          SET stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, $2), updated_at = now()
        WHERE id = $1 RETURNING stripe_payment_intent_id`,
      [ride.id, intent.id],
    );
    if (linked.rows[0].stripe_payment_intent_id !== intent.id) {
      intent = await deps.payments.retrievePaymentIntent(
        linked.rows[0].stripe_payment_intent_id,
      );
    }
  }

  if (ride.status !== "awaiting_payment") {
    throw new ApiError(
      409,
      ride.status === "cancelled" || ride.status === "no_driver"
        ? "RIDE_ENDED"
        : "ALREADY_REQUESTED",
      ride.status === "cancelled" || ride.status === "no_driver"
        ? "This request has ended. Please get a new quote."
        : "This ride has already been requested.",
    );
  }
  if (!intent.client_secret || ride.payment_status === "cancelled") {
    throw new ApiError(
      409,
      "PAYMENT_CANCELLED",
      "This request can no longer be paid. Please get a new quote.",
    );
  }

  const ephemeralKey = await deps.payments.createEphemeralKey(customerId);
  const body: BookingResponse = {
    paymentMethod: "card_online",
    rideId: ride.id,
    fareCents: ride.fare_cents,
    currency: asCurrency(ride.currency),
    paymentStatus: ride.payment_status,
    paymentIntentClientSecret: intent.client_secret,
    customerId,
    customerEphemeralKeySecret: ephemeralKey.secret,
  };
  return Response.json({ data: body }, { status: created ? 201 : 200 });
}

export async function reachStop(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const { rideId, viewer, driverProfileId } = await resolveViewer(
    deps,
    user,
    params.id,
  );
  if (viewer !== "driver") {
    throw forbidden("Only the assigned driver can update stops.");
  }
  const { index } = await readJson(request, stopReachedSchema);
  await withLockedRide(deps, rideId, async (tx, ride) => {
    if (ride.driver_profile_id !== driverProfileId) throw notFound("Ride");
    if (index < ride.stops_completed) return;
    if (ride.status !== "in_progress") {
      throw new ApiError(
        409,
        "INVALID_TRANSITION",
        "Stops can only be marked while the trip is in progress.",
      );
    }
    if (index >= ride.stops.length) throw notFound("Stop");
    if (index !== ride.stops_completed) {
      throw new ApiError(
        409,
        "STOP_OUT_OF_ORDER",
        "Mark the earlier stop as reached first.",
      );
    }
    const now = deps.now();
    await tx.query(
      `UPDATE mobility.rides
          SET stops_completed = stops_completed + 1, version = version + 1, updated_at = now()
        WHERE id = $1`,
      [rideId],
    );
    await tx.query(
      `INSERT INTO mobility.ride_events
         (ride_id, from_status, to_status, actor, actor_user_id, reason, created_at)
       VALUES ($1, 'in_progress', 'in_progress', 'driver', $2, $3, $4)`,
      [rideId, user.id, `stop_${index + 1}_reached`, now],
    );
    await tx.query(
      "DELETE FROM mobility.ride_routes WHERE ride_id = $1 AND leg = 'destination'",
      [rideId],
    );
  });
  return Response.json({
    data: await rideView(deps.db, rideId, "driver", deps.now()),
  });
}

export async function interruptRide(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const { rideId, viewer } = await resolveViewer(deps, user, params.id);
  if (viewer !== "driver") {
    throw forbidden("Only the assigned driver can end a trip early.");
  }
  const { reason } = await readJson(request, interruptRequestSchema);
  const ride = await withLockedRide(deps, rideId, (tx, ride) => {
    if (ride.status !== "in_progress" && ride.status !== "interrupted") {
      throw new ApiError(
        409,
        "INVALID_TRANSITION",
        "Only a trip in progress can be ended early.",
      );
    }
    return interruptTrip(tx, ride, user.id, deps.now(), reason);
  });
  await settlePayment(deps, ride, { force: true });
  return Response.json({
    data: await rideView(deps.db, rideId, "driver", deps.now()),
  });
}
