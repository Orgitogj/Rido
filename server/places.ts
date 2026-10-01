import {
  PLACES_RULES,
  type PlacesView,
  type SavedPlace,
  type SavedPlaceKind,
} from "../shared/account";

import { type Database, type SqlClient, transaction } from "./db";
import { ApiError, notFound } from "./errors";

interface PlaceRow {
  id: string;
  kind: SavedPlaceKind;
  label: string | null;
  address: string;
  latitude: number;
  longitude: number;
  provider_place_id: string | null;
  updated_at: Date;
}

const COLUMNS =
  "id, kind, label, address, latitude, longitude, provider_place_id, updated_at";

const view = (r: PlaceRow): SavedPlace => ({
  id: r.id,
  kind: r.kind,
  label: r.label,
  address: r.address,
  latitude: r.latitude,
  longitude: r.longitude,
  providerPlaceId: r.provider_place_id,
  updatedAt: new Date(r.updated_at).toISOString(),
});

export async function listPlaces(
  db: SqlClient,
  userId: string,
): Promise<PlacesView> {
  const { rows } = await db.query<PlaceRow>(
    `SELECT ${COLUMNS} FROM mobility.saved_places WHERE user_id = $1
      ORDER BY CASE kind WHEN 'home' THEN 0 WHEN 'work' THEN 1 ELSE 2 END, created_at, id`,
    [userId],
  );
  const custom = rows.filter((r) => r.kind === "custom").length;
  return {
    places: rows.map(view),
    customRemaining: Math.max(0, PLACES_RULES.maxCustom - custom),
  };
}

export async function savePlace(
  deps: { db: Database; now: () => Date },
  userId: string,
  input: {
    kind: SavedPlaceKind;
    label?: string | null;
    clientPlaceId?: string;
    address: string;
    latitude: number;
    longitude: number;
    providerPlaceId?: string | null;
  },
): Promise<{ place: SavedPlace; created: boolean }> {
  const now = deps.now();
  if (input.kind !== "custom") {
    const { rows } = await deps.db.query<PlaceRow & { inserted: boolean }>(
      `INSERT INTO mobility.saved_places
         (user_id, kind, address, latitude, longitude, provider_place_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       ON CONFLICT (user_id, kind) WHERE kind IN ('home', 'work') DO UPDATE
         SET address = EXCLUDED.address, latitude = EXCLUDED.latitude,
             longitude = EXCLUDED.longitude, provider_place_id = EXCLUDED.provider_place_id,
             updated_at = EXCLUDED.updated_at
       RETURNING ${COLUMNS}, (xmax = 0) AS inserted`,
      [
        userId,
        input.kind,
        input.address,
        input.latitude,
        input.longitude,
        input.providerPlaceId ?? null,
        now,
      ],
    );
    return { place: view(rows[0]), created: rows[0].inserted };
  }
  return transaction(deps.db, async (tx) => {
    await tx.query("SELECT id FROM mobility.users WHERE id = $1 FOR UPDATE", [
      userId,
    ]);
    const existing = await tx.query<PlaceRow>(
      `SELECT ${COLUMNS} FROM mobility.saved_places WHERE user_id = $1 AND client_place_id = $2`,
      [userId, input.clientPlaceId],
    );
    if (existing.rows[0]) {
      return { place: view(existing.rows[0]), created: false };
    }
    const { rows: count } = await tx.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM mobility.saved_places WHERE user_id = $1 AND kind = 'custom'",
      [userId],
    );
    if (count[0].n >= PLACES_RULES.maxCustom) {
      throw new ApiError(
        409,
        "PLACE_LIMIT",
        `You can save up to ${PLACES_RULES.maxCustom} named places. Delete one to add another.`,
      );
    }
    const { rows } = await tx.query<PlaceRow>(
      `INSERT INTO mobility.saved_places
         (user_id, kind, label, address, latitude, longitude, provider_place_id,
          client_place_id, created_at, updated_at)
       VALUES ($1, 'custom', $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING ${COLUMNS}`,
      [
        userId,
        input.label,
        input.address,
        input.latitude,
        input.longitude,
        input.providerPlaceId ?? null,
        input.clientPlaceId,
        now,
      ],
    );
    return { place: view(rows[0]), created: true };
  });
}

export async function updatePlace(
  deps: { db: Database; now: () => Date },
  userId: string,
  placeId: string,
  patch: {
    label?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
    providerPlaceId?: string | null;
  },
): Promise<SavedPlace> {
  const { rows: current } = await deps.db.query<{ kind: SavedPlaceKind }>(
    "SELECT kind FROM mobility.saved_places WHERE id = $1 AND user_id = $2",
    [placeId, userId],
  );
  if (!current[0]) throw notFound("Place");
  if (patch.label !== undefined && current[0].kind !== "custom") {
    throw new ApiError(
      422,
      "LABEL_NOT_EDITABLE",
      "Home and Work can't be renamed.",
    );
  }
  const { rows } = await deps.db.query<PlaceRow>(
    `UPDATE mobility.saved_places
        SET label = COALESCE($3, label),
            address = COALESCE($4, address),
            latitude = COALESCE($5, latitude),
            longitude = COALESCE($6, longitude),
            provider_place_id = CASE WHEN $4::text IS NULL THEN provider_place_id ELSE $7 END,
            updated_at = $8
      WHERE id = $1 AND user_id = $2
      RETURNING ${COLUMNS}`,
    [
      placeId,
      userId,
      patch.label ?? null,
      patch.address ?? null,
      patch.latitude ?? null,
      patch.longitude ?? null,
      patch.providerPlaceId ?? null,
      deps.now(),
    ],
  );
  if (!rows[0]) throw notFound("Place");
  return view(rows[0]);
}

export async function deletePlace(
  db: SqlClient,
  userId: string,
  placeId: string,
) {
  const { rows } = await db.query(
    "DELETE FROM mobility.saved_places WHERE id = $1 AND user_id = $2 RETURNING id",
    [placeId, userId],
  );
  if (!rows[0]) throw notFound("Place");
}
