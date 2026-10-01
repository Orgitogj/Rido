import {
  availabilityRequestSchema,
  type DriverDashboard,
  driverApplicationSchema,
  documentUploadSchema,
  heartbeatRequestSchema,
  offerIdSchema,
  type RideOfferView,
} from "../../shared/contracts";
import { eligibleDriverSql } from "../eligibility";
import { ApiError, notFound } from "../errors";
import { type Deps, parseInput, readJson } from "../http";
import { ASSIGNED_STATUSES, transitionRide } from "../lifecycle";
import { clearDriverLocation, recordDriverLocation } from "../location";
import { advanceRide, offerToNextDriver } from "../matching";
import { enforceRateLimit } from "../rateLimit";
import { summarySql, toSummary } from "../ratings";
import { advanceRideById, rideViews, sweep, withLockedRide } from "../rides";
import { type AppUser, ensureUser } from "../users";
import {
  applicantView,
  completeUpload,
  driverEligibility,
  handleIneligibleDriver,
  profileDocuments,
  type ProfileRow as VerificationProfileRow,
  reopenApplication,
  requestUpload,
  saveApplication,
  submitApplication,
} from "../verification";

type ProfileRow = VerificationProfileRow & {
  rating_summary?: { count: number; avg: number | null } | null;
};

async function profileView(deps: Deps, p: ProfileRow) {
  return applicantView(
    p,
    await profileDocuments(deps.db, p.id),
    toSummary(p.rating_summary ?? null),
    deps.now(),
  );
}

export async function currentUser(request: Request, deps: Deps) {
  const identity = await deps.authenticate(request);
  return ensureUser(deps.db, identity);
}

async function findProfile(deps: Deps, user: AppUser) {
  const { rows } = await deps.db.query<ProfileRow>(
    `SELECT dp.*, ${summarySql("dp.user_id", "passenger", "$2::timestamptz")} AS rating_summary
       FROM mobility.driver_profiles dp WHERE dp.user_id = $1`,
    [user.id, deps.now()],
  );
  return rows[0] ?? null;
}

export async function requireDriverProfile(deps: Deps, user: AppUser) {
  const profile = await findProfile(deps, user);
  if (!profile) {
    throw new ApiError(403, "NOT_A_DRIVER", "This account is not a driver.");
  }
  return profile;
}

export async function requireApprovedDriver(deps: Deps, user: AppUser) {
  const profile = await requireDriverProfile(deps, user);
  const { eligible, reasons } = driverEligibility(profile, deps.now());
  if (!eligible) {
    throw new ApiError(
      403,
      profile.status === "approved"
        ? "DRIVER_APPROVAL_EXPIRED"
        : "DRIVER_NOT_APPROVED",
      reasons[0] ?? "You can't drive right now.",
    );
  }
  return profile;
}

async function dashboard(
  deps: Deps,
  profile: ProfileRow | null,
): Promise<DriverDashboard> {
  const now = deps.now();
  if (!profile) {
    return {
      profile: null,
      offer: null,
      activeRide: null,
      serverTime: now.toISOString(),
    };
  }
  const { rows: offers } = await deps.db.query<{
    id: string;
    ride_id: string;
    expires_at: Date;
    distance_meters: number;
    origin_address: string;
    origin_latitude: number;
    origin_longitude: number;
    destination_address: string;
    destination_latitude: number;
    destination_longitude: number;
    fare_cents: number;
    trip_distance: number | null;
    passenger_summary: { count: number; avg: number | null } | null;
  }>(
    `SELECT o.id, o.ride_id, o.expires_at, o.distance_meters,
            r.origin_address, r.origin_latitude, r.origin_longitude,
            r.destination_address, r.destination_latitude, r.destination_longitude,
            r.fare_cents, r.distance_meters AS trip_distance,
            ${summarySql("r.user_id", "driver", "$2::timestamptz")} AS passenger_summary
       FROM mobility.ride_offers o
       JOIN mobility.rides r ON r.id = o.ride_id
      WHERE o.driver_profile_id = $1 AND o.status = 'pending'
        AND o.expires_at > $2 AND r.status = 'offered'`,
    [profile.id, now],
  );
  const o = offers[0];
  const offer: RideOfferView | null = o
    ? {
        id: o.id,
        rideId: o.ride_id,
        pickup: {
          address: o.origin_address,
          latitude: o.origin_latitude,
          longitude: o.origin_longitude,
        },
        destination: {
          address: o.destination_address,
          latitude: o.destination_latitude,
          longitude: o.destination_longitude,
        },
        fareCents: o.fare_cents,
        distanceToPickupMeters: o.distance_meters,
        tripDistanceMeters: o.trip_distance,
        expiresAt: new Date(o.expires_at).toISOString(),
        expiresInSeconds: Math.max(
          0,
          Math.floor((new Date(o.expires_at).getTime() - now.getTime()) / 1000),
        ),
        passengerRating: toSummary(o.passenger_summary),
      }
    : null;

  const [activeRide] = await rideViews(
    deps.db,
    "r.driver_profile_id = $1 AND r.status = ANY($2::text[])",
    [profile.id, ASSIGNED_STATUSES],
    "driver",
    now,
    "LIMIT 1",
  );
  return {
    profile: await profileView(deps, profile),
    offer,
    activeRide: activeRide ?? null,
    serverTime: now.toISOString(),
  };
}

export async function getDriverProfile(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const profile = await findProfile(deps, user);
  return Response.json({
    data: profile ? await profileView(deps, profile) : null,
  });
}

export async function applyToDrive(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const input = await readJson(request, driverApplicationSchema);
  const { created } = await saveApplication(deps, user.id, input);
  const profile = (await findProfile(deps, user))!;
  return Response.json(
    { data: await profileView(deps, profile) },
    { status: created ? 201 : 200 },
  );
}

export async function submitDriverApplication(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  await submitApplication(deps, user.id);
  return Response.json({
    data: await profileView(deps, (await findProfile(deps, user))!),
  });
}

export async function reopenDriverApplication(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  await reopenApplication(deps, user.id);
  return Response.json({
    data: await profileView(deps, (await findProfile(deps, user))!),
  });
}

export async function requestDocumentUpload(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const input = await readJson(request, documentUploadSchema);
  await enforceRateLimit(deps.db, "uploadTickets", user.id, deps.now());
  return Response.json(
    { data: await requestUpload(deps, user.id, input) },
    { status: 201 },
  );
}

export async function completeDocumentUpload(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const documentId = parseInput(offerIdSchema, params.id);
  return Response.json({
    data: await completeUpload(deps, user.id, documentId),
  });
}

export async function setAvailability(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const { online, location } = await readJson(
    request,
    availabilityRequestSchema,
  );
  const profile = online
    ? await requireApprovedDriver(deps, user)
    : await requireDriverProfile(deps, user);
  const now = deps.now();

  if (online) {
    if (!location) {
      throw new ApiError(
        400,
        "LOCATION_REQUIRED",
        "Share your location to go online.",
      );
    }
    const recorded = await recordDriverLocation(
      deps.db,
      profile.id,
      {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy ?? null,
        recordedAt: location.recordedAt ?? now.toISOString(),
      },
      now,
      { reset: true },
    );
    if (!recorded.accepted) {
      throw new ApiError(
        422,
        "LOCATION_REJECTED",
        recorded.reason === "low_accuracy"
          ? "Your GPS signal is too weak. Move somewhere with a clearer view of the sky and try again."
          : "Your location couldn't be confirmed. Please try again.",
      );
    }
    await deps.db.query(
      `UPDATE mobility.driver_profiles
          SET online = true, last_seen_at = $2, updated_at = now()
        WHERE id = $1`,
      [profile.id, now],
    );
    await sweep(deps, 25, { maintenance: "throttled" });
  } else {
    const busy = await deps.db.query(
      `SELECT 1 FROM mobility.rides
        WHERE driver_profile_id = $1 AND status = ANY($2::text[])`,
      [profile.id, ASSIGNED_STATUSES],
    );
    if (busy.rows.length) {
      throw new ApiError(
        409,
        "ACTIVE_RIDE",
        "Finish or cancel your current ride before going offline.",
      );
    }
    await deps.db.query(
      `UPDATE mobility.driver_profiles SET online = false, updated_at = now() WHERE id = $1`,
      [profile.id],
    );
    await clearDriverLocation(deps.db, profile.id);
    const pending = await deps.db.query<{ ride_id: string }>(
      `SELECT ride_id FROM mobility.ride_offers
        WHERE driver_profile_id = $1 AND status = 'pending'`,
      [profile.id],
    );
    for (const { ride_id } of pending.rows)
      await advanceRideById(deps, ride_id);
  }
  return Response.json({
    data: await dashboard(deps, await findProfile(deps, user)),
  });
}

export async function heartbeat(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const { location } = await readJson(request, heartbeatRequestSchema);
  const profile = await findProfile(deps, user);
  if (profile && !driverEligibility(profile, deps.now()).eligible) {
    if (profile.online)
      await handleIneligibleDriver(deps, profile.id, "approval_expired");
  } else if (profile) {
    const now = deps.now();
    await deps.db.query(
      "UPDATE mobility.driver_profiles SET last_seen_at = $2 WHERE id = $1",
      [profile.id, now],
    );
    if (location) {
      await recordDriverLocation(
        deps.db,
        profile.id,
        {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy ?? null,
          recordedAt: location.recordedAt ?? now.toISOString(),
        },
        now,
      );
    }
    await sweep(deps, 25, { maintenance: "throttled" });
  }
  return Response.json({
    data: await dashboard(deps, profile ? await findProfile(deps, user) : null),
  });
}

async function respondToOffer(
  request: Request,
  params: { id?: string },
  deps: Deps,
  accept: boolean,
) {
  const user = await currentUser(request, deps);
  const profile = await requireApprovedDriver(deps, user);
  const offerId = parseInput(offerIdSchema, params.id);

  const { rows } = await deps.db.query<{ ride_id: string }>(
    "SELECT ride_id FROM mobility.ride_offers WHERE id = $1 AND driver_profile_id = $2",
    [offerId, profile.id],
  );
  if (!rows[0]) throw notFound("Offer");

  const now = deps.now();
  const outcome = await withLockedRide(
    deps,
    rows[0].ride_id,
    async (tx, ride) => {
      const { rows: offers } = await tx.query<{
        status: string;
        expires_at: Date;
      }>(
        "SELECT status, expires_at FROM mobility.ride_offers WHERE id = $1 FOR UPDATE",
        [offerId],
      );
      const offer = offers[0];

      if (accept && offer.status === "accepted") return { ok: true as const };
      if (!accept && offer.status === "declined") return { ok: true as const };
      if (offer.status !== "pending" || ride.status !== "offered") {
        return { ok: false as const, code: "OFFER_UNAVAILABLE" };
      }
      if (new Date(offer.expires_at) <= now) {
        await advanceRide(tx, ride, now);
        return { ok: false as const, code: "OFFER_EXPIRED" };
      }

      if (accept) {
        const { rows: me } = await tx.query<{
          online: boolean;
          eligible: boolean;
        }>(
          `SELECT dp.online, ${eligibleDriverSql("dp", "$2::timestamptz")} AS eligible
             FROM mobility.driver_profiles dp WHERE dp.id = $1 FOR UPDATE`,
          [profile.id, now],
        );
        if (!me[0].online || !me[0].eligible) {
          return { ok: false as const, code: "OFFER_UNAVAILABLE" };
        }
      }
      await tx.query(
        "UPDATE mobility.ride_offers SET status = $2, responded_at = $3 WHERE id = $1",
        [offerId, accept ? "accepted" : "declined", now],
      );
      if (accept) {
        await transitionRide(tx, ride, "accepted", {
          actor: "driver",
          actorUserId: user.id,
          now,
          set: { driver_profile_id: profile.id },
        });
      } else {
        const requested = await transitionRide(tx, ride, "requested", {
          actor: "system",
          now,
          reason: "offer_declined",
        });
        await offerToNextDriver(tx, requested, now);
      }
      return { ok: true as const };
    },
  );

  if (!outcome.ok) {
    throw new ApiError(
      409,
      outcome.code,
      outcome.code === "OFFER_EXPIRED"
        ? "This request expired before you responded."
        : "This request is no longer available.",
    );
  }
  return Response.json({
    data: await dashboard(deps, await findProfile(deps, user)),
  });
}

export const acceptOffer = (
  request: Request,
  params: { id?: string },
  deps: Deps,
) => respondToOffer(request, params, deps, true);

export const declineOffer = (
  request: Request,
  params: { id?: string },
  deps: Deps,
) => respondToOffer(request, params, deps, false);
