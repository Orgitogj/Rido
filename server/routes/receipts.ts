import {
  type DriverTrip,
  type PassengerSupportRequest,
  receiptIdSchema,
  supportRequestSchema,
} from "../../shared/contracts";
import { notFound } from "../errors";
import { type Deps, parseInput, readJson } from "../http";
import { ratingEligibility } from "../ratings";
import { RECEIPT_SQL, receiptFrom, type ReceiptRow } from "../receipts";
import { ensureUser } from "../users";

import { requireDriverProfile } from "./driver";

const VISIBLE = "(r.requested_at IS NOT NULL OR r.status = 'legacy')";

async function currentUser(request: Request, deps: Deps) {
  return ensureUser(deps.db, await deps.authenticate(request));
}

export async function listReceipts(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const { rows } = await deps.db.query<ReceiptRow>(
    `${RECEIPT_SQL} WHERE r.user_id = $1 AND ${VISIBLE}
      ORDER BY r.created_at DESC, r.id DESC LIMIT 50`,
    [user.id],
  );
  const now = deps.now();
  return Response.json({ data: rows.map((r) => receiptFrom(r, now)) });
}

export async function getReceipt(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const rideId = parseInput(receiptIdSchema, params.id);
  const { rows } = await deps.db.query<ReceiptRow>(
    `${RECEIPT_SQL} WHERE r.id = $1 AND r.user_id = $2 AND ${VISIBLE}`,
    [rideId, user.id],
  );
  if (!rows[0]) throw notFound("Receipt");
  return Response.json({ data: receiptFrom(rows[0], deps.now()) });
}

export async function listDriverTrips(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const profile = await requireDriverProfile(deps, user);
  const { rows } = await deps.db.query<{
    id: string;
    origin_address: string;
    origin_latitude: number;
    origin_longitude: number;
    destination_address: string;
    destination_latitude: number;
    destination_longitude: number;
    accepted_at: Date | null;
    started_at: Date | null;
    completed_at: Date | null;
    fare_cents: number;
    distance_meters: number | null;
    status: "completed";
    payment_status: string;
    demo_driver_id: number | null;
    driver_profile_id: string | null;
    rated: boolean;
  }>(
    `SELECT r.id, r.origin_address, r.origin_latitude, r.origin_longitude,
            r.destination_address, r.destination_latitude, r.destination_longitude,
            r.accepted_at, r.started_at, r.completed_at, r.fare_cents, r.distance_meters,
            r.status, r.payment_status, r.demo_driver_id, r.driver_profile_id,
            EXISTS (SELECT 1 FROM mobility.ratings g
                     WHERE g.ride_id = r.id AND g.rater_role = 'driver') AS rated
       FROM mobility.rides r
      WHERE r.driver_profile_id = $1 AND r.status = 'completed'
      ORDER BY r.completed_at DESC LIMIT 50`,
    [profile.id],
  );
  const now = deps.now();
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  const trips: DriverTrip[] = rows.map((r) => ({
    rideId: r.id,
    pickup: {
      address: r.origin_address,
      latitude: r.origin_latitude,
      longitude: r.origin_longitude,
    },
    destination: {
      address: r.destination_address,
      latitude: r.destination_latitude,
      longitude: r.destination_longitude,
    },
    acceptedAt: iso(r.accepted_at),
    startedAt: iso(r.started_at),
    completedAt: iso(r.completed_at),
    fareCents: r.fare_cents,
    currency: "usd",
    distanceMeters: r.distance_meters,
    ratingPending: !r.rated && ratingEligibility(r, now).reason === null,
  }));
  return Response.json({ data: trips });
}

export async function createSupportRequest(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const rideId = parseInput(receiptIdSchema, params.id);
  const { category, message } = await readJson(request, supportRequestSchema);
  const { rows: owned } = await deps.db.query(
    `SELECT 1 FROM mobility.rides r WHERE r.id = $1 AND r.user_id = $2 AND ${VISIBLE}`,
    [rideId, user.id],
  );
  if (!owned.length) throw notFound("Ride");
  const { rows } = await deps.db.query<{ id: string; created_at: Date }>(
    `INSERT INTO mobility.support_requests (ride_id, user_id, category, message)
     VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
    [rideId, user.id, category, message],
  );
  await deps.db.query(
    `INSERT INTO mobility.support_events (support_request_id, action, to_status)
     VALUES ($1, 'created', 'open')`,
    [rows[0].id],
  );
  return Response.json(
    {
      data: {
        id: rows[0].id,
        status: "open",
        message:
          "Thanks. Our team will review this trip. You can follow the status here; any refund is decided by support and shown on your receipt once processed.",
      },
    },
    { status: 201 },
  );
}

export async function listRideSupport(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const rideId = parseInput(receiptIdSchema, params.id);
  const { rows } = await deps.db.query<{
    id: string;
    ride_id: string;
    category: string;
    status: PassengerSupportRequest["status"];
    created_at: Date;
    updated_at: Date;
    resolved_at: Date | null;
    resolution_message: string | null;
  }>(
    `SELECT id, ride_id, category, status, created_at, updated_at, resolved_at, resolution_message
       FROM mobility.support_requests
      WHERE ride_id = $1 AND user_id = $2
      ORDER BY created_at DESC LIMIT 20`,
    [rideId, user.id],
  );
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  const items: PassengerSupportRequest[] = rows.map((r) => ({
    id: r.id,
    rideId: r.ride_id,
    category: r.category,
    status: r.status,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    resolvedAt: iso(r.resolved_at),
    resolutionMessage: r.status === "resolved" ? r.resolution_message : null,
  }));
  return Response.json({ data: items });
}
