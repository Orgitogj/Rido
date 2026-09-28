import {
  type BookingResponse,
  bookingRequestSchema,
  cancelRequestSchema,
  driverStatusRequestSchema,
  interruptRequestSchema,
  rideIdSchema,
} from "../../shared/contracts";
import { driverCancel, interruptTrip, passengerCancel } from "../cancellation";
import { ApiError, notFound } from "../errors";
import { type Deps, parseInput, readJson } from "../http";
import { ACTIVE_STATUSES, type RideRow, transitionRide } from "../lifecycle";
import {
  advanceRideById,
  rideView,
  rideViews,
  settlePayment,
  syncIntent,
  withLockedRide,
} from "../rides";
import { type AppUser, ensureUser } from "../users";

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
  const { rideId, viewer } = await resolveViewer(deps, user, params.id);
  if (viewer !== "driver") {
    throw forbidden("Only the assigned driver can update the trip status.");
  }
  const { status } = await readJson(request, driverStatusRequestSchema);

  const ride: RideRow = await withLockedRide(deps, rideId, (tx, ride) =>
    ride.status === status
      ? Promise.resolve(ride)
      : transitionRide(tx, ride, status, {
          actor: "driver",
          actorUserId: user.id,
          now: deps.now(),
        }),
  );
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
       distance_meters, duration_seconds, fare_cents, currency, created_at)
     SELECT id, user_id,
            pickup_address, pickup_latitude, pickup_longitude,
            destination_address, destination_latitude, destination_longitude,
            distance_meters, duration_seconds, fare_cents, currency, $2
       FROM mobility.quotes
      WHERE id = $1 AND expires_at > $2
     ON CONFLICT (quote_id) DO NOTHING
     RETURNING *`,
    [quoteId, deps.now()],
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
      throw new ApiError(
        410,
        "QUOTE_EXPIRED",
        "This price has expired. Please get a new quote.",
      );
    }
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
        currency: ride.currency.trim(),
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
    rideId: ride.id,
    fareCents: ride.fare_cents,
    currency: "usd",
    paymentStatus: ride.payment_status,
    paymentIntentClientSecret: intent.client_secret,
    customerId,
    customerEphemeralKeySecret: ephemeralKey.secret,
  };
  return Response.json({ data: body }, { status: created ? 201 : 200 });
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
