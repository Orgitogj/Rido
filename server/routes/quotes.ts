import { type QuoteResponse, quoteRequestSchema } from "../../shared/contracts";
import { haversineMeters } from "../../shared/geo";
import { ApiError } from "../errors";
import { computeFare, effectivePolicy, pricingVersion } from "../fares";
import { type Deps, readJson } from "../http";
import { onlineDriversNear } from "../matching";
import { QUOTE } from "../pricing";
import { RoutingUnavailableError } from "../routing";
import { reserveRouting } from "../routingBudget";
import { serviceAreaForTrip } from "../serviceAreas";
import { ensureUser } from "../users";

interface QuoteRow {
  id: string;
  fare_cents: number;
  currency: string;
  distance_meters: number;
  duration_seconds: number;
  expires_at: Date;
}

const log = (event: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ event, ...fields }));

const routingUnavailable = (code: string, message: string, retry: number) =>
  new ApiError(503, code, message, undefined, retry);

export async function createQuote(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const identity = await deps.authenticate(request);
  const { pickup, destination } = await readJson(request, quoteRequestSchema);

  if (haversineMeters(pickup, destination) < QUOTE.minTripMeters) {
    throw new ApiError(
      422,
      "TRIP_TOO_SHORT",
      "Pickup and destination are too close together.",
    );
  }

  const area = await serviceAreaForTrip(deps.db, pickup, destination);
  const now = deps.now();
  const policy = await effectivePolicy(deps.db, area.id, now);
  if (!policy) {
    throw new ApiError(
      503,
      "PRICING_NOT_CONFIGURED",
      "Rides in this area aren't priced yet. Please try again later.",
    );
  }

  const user = await ensureUser(deps.db, identity);
  const nearby = async () =>
    (await onlineDriversNear(deps.db, pickup, now, user.id)).length;
  const respond = async (row: QuoteRow, status: number) => {
    const body: QuoteResponse = {
      quote: {
        id: row.id,
        fareCents: row.fare_cents,
        currency: "usd",
        distanceMeters: row.distance_meters,
        durationSeconds: row.duration_seconds,
        expiresAt: new Date(row.expires_at).toISOString(),
      },
      driversNearby: await nearby(),
    };
    return Response.json({ data: body }, { status });
  };

  const { rows: reusable } = await deps.db.query<QuoteRow>(
    `SELECT q.id, q.fare_cents, q.currency, q.distance_meters, q.duration_seconds, q.expires_at
       FROM mobility.quotes q
      WHERE q.user_id = $1 AND q.fare_policy_id = $2
        AND round(q.pickup_latitude::numeric, 5) = round($3::numeric, 5)
        AND round(q.pickup_longitude::numeric, 5) = round($4::numeric, 5)
        AND round(q.destination_latitude::numeric, 5) = round($5::numeric, 5)
        AND round(q.destination_longitude::numeric, 5) = round($6::numeric, 5)
        AND q.created_at >= $7 AND q.expires_at >= $8
        AND NOT EXISTS (SELECT 1 FROM mobility.rides r WHERE r.quote_id = q.id)
      ORDER BY q.created_at DESC LIMIT 1`,
    [
      user.id,
      policy.id,
      pickup.latitude,
      pickup.longitude,
      destination.latitude,
      destination.longitude,
      new Date(now.getTime() - QUOTE.reuseWindowSeconds * 1000),
      new Date(now.getTime() + QUOTE.reuseMinRemainingSeconds * 1000),
    ],
  );
  if (reusable[0]) return respond(reusable[0], 200);

  const { rows: recent } = await deps.db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM mobility.quotes WHERE user_id = $1 AND created_at >= $2",
    [user.id, new Date(now.getTime() - QUOTE.perUserWindowSeconds * 1000)],
  );
  if (recent[0].n >= QUOTE.perUserLimit) {
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "Too many price requests. Please wait a moment and try again.",
      undefined,
      60,
    );
  }

  if (!deps.routing) {
    log("routing_not_configured", {});
    throw routingUnavailable(
      "ROUTING_NOT_CONFIGURED",
      "Pricing is unavailable because road routing isn't set up on the server.",
      300,
    );
  }
  if (!(await reserveRouting(deps.db, "routes", 1, now))) {
    throw routingUnavailable(
      "ROUTING_BUSY",
      "We're getting a lot of price requests. Please try again in a minute.",
      60,
    );
  }
  let route;
  try {
    route = await deps.routing.route(pickup, destination);
  } catch (e) {
    log("quote_routing_failed", {
      error: e instanceof RoutingUnavailableError ? e.message : "unknown",
    });
    throw routingUnavailable(
      "ROUTING_UNAVAILABLE",
      "We couldn't calculate a route right now. Please try again.",
      QUOTE.routingRetryAfterSeconds,
    );
  }
  if (!route) {
    throw new ApiError(
      422,
      "NO_ROUTE",
      "There's no drivable route between these places. Choose a different pickup or destination.",
    );
  }
  if (
    route.distanceMeters < QUOTE.minTripMeters ||
    route.durationSeconds <= 0
  ) {
    throw new ApiError(
      422,
      "TRIP_TOO_SHORT",
      "Pickup and destination are too close together.",
    );
  }
  if (route.distanceMeters > QUOTE.maxTripMeters) {
    throw new ApiError(
      422,
      "TRIP_TOO_LONG",
      "This trip is longer than the service allows.",
    );
  }

  const fare = computeFare(policy, route);
  const expiresAt = new Date(now.getTime() + QUOTE.ttlSeconds * 1000);
  const { rows } = await deps.db.query<QuoteRow>(
    `INSERT INTO mobility.quotes (
       user_id,
       pickup_address, pickup_latitude, pickup_longitude,
       destination_address, destination_latitude, destination_longitude,
       distance_meters, duration_seconds, fare_cents, currency, pricing_version,
       service_area_id, fare_policy_id, route_source,
       base_cents, distance_cents, time_cents, minimum_applied,
       expires_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     RETURNING id, fare_cents, currency, distance_meters, duration_seconds, expires_at`,
    [
      user.id,
      pickup.address,
      pickup.latitude,
      pickup.longitude,
      destination.address,
      destination.latitude,
      destination.longitude,
      route.distanceMeters,
      Math.max(1, route.durationSeconds),
      fare.totalCents,
      policy.currency.trim(),
      pricingVersion(area.code, policy.version),
      area.id,
      policy.id,
      deps.routing.source,
      fare.baseCents,
      fare.distanceCents,
      fare.timeCents,
      fare.minimumApplied,
      expiresAt,
      now,
    ],
  );
  return respond(rows[0], 201);
}
