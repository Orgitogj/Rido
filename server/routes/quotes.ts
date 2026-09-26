import { type QuoteResponse, quoteRequestSchema } from "../../shared/contracts";
import { ApiError } from "../errors";
import { type Deps, readJson } from "../http";
import { onlineDriversNear } from "../matching";
import { estimateTrip, fareCents, PRICING } from "../pricing";
import { ensureUser } from "../users";

export async function createQuote(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const identity = await deps.authenticate(request);
  const { pickup, destination } = await readJson(request, quoteRequestSchema);

  const check = estimateTrip(pickup, destination);
  if (!check.ok) {
    throw check.reason === "TOO_SHORT"
      ? new ApiError(
          422,
          "TRIP_TOO_SHORT",
          "Pickup and destination are too close together.",
        )
      : new ApiError(
          422,
          "TRIP_TOO_LONG",
          "This trip is longer than the service allows.",
        );
  }

  const user = await ensureUser(deps.db, identity);
  const now = deps.now();
  const expiresAt = new Date(now.getTime() + PRICING.quoteTtlSeconds * 1000);
  const fare = fareCents(check.trip, 10_000);

  const { rows } = await deps.db.query<{ id: string }>(
    `INSERT INTO mobility.quotes (
       user_id,
       pickup_address, pickup_latitude, pickup_longitude,
       destination_address, destination_latitude, destination_longitude,
       distance_meters, duration_seconds, fare_cents, pricing_version,
       expires_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      user.id,
      pickup.address,
      pickup.latitude,
      pickup.longitude,
      destination.address,
      destination.latitude,
      destination.longitude,
      check.trip.distanceMeters,
      check.trip.durationSeconds,
      fare,
      PRICING.version,
      expiresAt,
      now,
    ],
  );

  const nearby = await onlineDriversNear(deps.db, pickup, now, user.id);
  const body: QuoteResponse = {
    quote: {
      id: rows[0].id,
      fareCents: fare,
      currency: "usd",
      distanceMeters: check.trip.distanceMeters,
      durationSeconds: check.trip.durationSeconds,
      expiresAt: expiresAt.toISOString(),
    },
    driversNearby: nearby.length,
  };
  return Response.json({ data: body }, { status: 201 });
}
