import {
  type CategoryOption,
  DEFAULT_VEHICLE_CATEGORY_ID,
  type DriverCategoryView,
  type VehicleCategoryAdmin,
} from "../shared/vehicleCategory";

import { type Database, type SqlClient, transaction } from "./db";
import { ApiError, notFound } from "./errors";
import { audit, type OperatorRow } from "./operators";

export interface CategoryRow {
  id: string;
  code: string;
  name: string;
  description: string;
  capacity: number;
  status: "active" | "inactive";
  is_development: boolean;
  is_default: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const iso = (d: Date) => new Date(d).toISOString();

const snapshot = (c: CategoryRow) => ({
  code: c.code,
  name: c.name,
  description: c.description,
  capacity: c.capacity,
  status: c.status,
  isDevelopment: c.is_development,
  version: c.version,
});

async function categoryEvent(
  tx: SqlClient,
  e: {
    categoryId: string;
    operator: OperatorRow | null;
    action: string;
    reason: string;
    snapshot: unknown;
    now: Date;
  },
) {
  await tx.query(
    `INSERT INTO mobility.vehicle_category_events
       (vehicle_category_id, actor, operator_id, action, reason, snapshot, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      e.categoryId,
      e.operator ? "operator" : "system",
      e.operator?.id ?? null,
      e.action,
      e.reason,
      JSON.stringify(e.snapshot),
      e.now,
    ],
  );
}

export async function categoryForRequest(
  db: SqlClient,
  categoryId: string | undefined,
  passengerCount: number,
): Promise<CategoryRow> {
  let category: CategoryRow | undefined;
  if (categoryId) {
    category = (
      await db.query<CategoryRow>(
        "SELECT * FROM mobility.vehicle_categories WHERE id = $1",
        [categoryId],
      )
    ).rows[0];
  } else {
    const { rows } = await db.query<CategoryRow>(
      `SELECT * FROM mobility.vehicle_categories WHERE status = 'active'
        ORDER BY is_default DESC, created_at LIMIT 2`,
    );
    category = rows[0]?.is_default || rows.length === 1 ? rows[0] : undefined;
    if (!category) {
      throw new ApiError(
        400,
        "CATEGORY_REQUIRED",
        "Choose a vehicle category for this ride.",
      );
    }
  }
  if (!category || category.status !== "active") {
    throw new ApiError(
      422,
      "CATEGORY_UNAVAILABLE",
      "This vehicle category isn't available right now. Choose another one.",
    );
  }
  if (passengerCount > category.capacity) {
    throw new ApiError(
      422,
      "TOO_MANY_PASSENGERS",
      `This category carries up to ${category.capacity} passengers.`,
    );
  }
  return category;
}

export const categoryMatchSql = (
  driverAlias: string,
  categoryRef: string,
  passengersRef: string,
) =>
  `(${categoryRef}::uuid IS NULL OR EXISTS (
      SELECT 1 FROM mobility.driver_vehicle_categories dvc
       WHERE dvc.driver_profile_id = ${driverAlias}.id
         AND dvc.vehicle_category_id = ${categoryRef}::uuid))
   AND ${driverAlias}.vehicle_seats >= ${passengersRef}::int`;

export async function driverCategories(
  db: SqlClient,
  profileId: string,
): Promise<DriverCategoryView[]> {
  const { rows } = await db.query<CategoryRow>(
    `SELECT c.* FROM mobility.driver_vehicle_categories dvc
       JOIN mobility.vehicle_categories c ON c.id = dvc.vehicle_category_id
      WHERE dvc.driver_profile_id = $1 ORDER BY c.is_default DESC, c.name`,
    [profileId],
  );
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    capacity: c.capacity,
    active: c.status === "active",
  }));
}

export async function replaceDriverCategories(
  tx: SqlClient,
  profileId: string,
  categoryIds: string[],
  by: { operator: OperatorRow } | { source: "cli" },
  now: Date,
): Promise<{ ok: true; names: string[] } | { ok: false }> {
  const { rows } = await tx.query<{ id: string; name: string }>(
    "SELECT id, name FROM mobility.vehicle_categories WHERE id = ANY($1::uuid[])",
    [categoryIds],
  );
  if (rows.length !== categoryIds.length) return { ok: false };
  await tx.query(
    `DELETE FROM mobility.driver_vehicle_categories
      WHERE driver_profile_id = $1 AND NOT (vehicle_category_id = ANY($2::uuid[]))`,
    [profileId, categoryIds],
  );
  for (const id of categoryIds) {
    await tx.query(
      `INSERT INTO mobility.driver_vehicle_categories
         (driver_profile_id, vehicle_category_id, source, granted_by, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (driver_profile_id, vehicle_category_id) DO NOTHING`,
      [
        profileId,
        id,
        "operator" in by ? "operator" : "cli",
        "operator" in by ? by.operator.id : null,
        now,
      ],
    );
  }
  return { ok: true, names: rows.map((r) => r.name).sort() };
}

async function adminRows(db: SqlClient, id?: string) {
  const { rows } = await db.query<
    CategoryRow & { authorized_drivers: number; areas_priced: number }
  >(
    `SELECT c.*,
            (SELECT count(*)::int FROM mobility.driver_vehicle_categories d
              WHERE d.vehicle_category_id = c.id) AS authorized_drivers,
            (SELECT count(DISTINCT fp.service_area_id)::int FROM mobility.fare_policies fp
              WHERE fp.vehicle_category_id = c.id AND fp.status = 'scheduled') AS areas_priced
       FROM mobility.vehicle_categories c
      WHERE $1::uuid IS NULL OR c.id = $1::uuid
      ORDER BY c.is_default DESC, c.status, c.name`,
    [id ?? null],
  );
  return rows;
}

export async function listCategoriesAdmin(
  db: SqlClient,
): Promise<VehicleCategoryAdmin[]> {
  const rows = await adminRows(db);
  const { rows: events } = await db.query<{
    vehicle_category_id: string;
    action: string;
    actor: string;
    operator: string | null;
    reason: string | null;
    created_at: Date;
  }>(
    `SELECT e.vehicle_category_id, e.action, e.actor, o.display_name AS operator,
            e.reason, e.created_at
       FROM mobility.vehicle_category_events e
       LEFT JOIN mobility.operators o ON o.id = e.operator_id
      ORDER BY e.id DESC LIMIT 300`,
  );
  return rows.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description,
    capacity: c.capacity,
    status: c.status,
    isDevelopment: c.is_development,
    isDefault: c.is_default,
    version: c.version,
    authorizedDrivers: c.authorized_drivers,
    areasPriced: c.areas_priced,
    updatedAt: iso(c.updated_at),
    history: events
      .filter((e) => e.vehicle_category_id === c.id)
      .slice(0, 20)
      .map((e) => ({
        action: e.action,
        actor: e.actor,
        operator: e.operator,
        reason: e.reason,
        createdAt: iso(e.created_at),
      })),
  }));
}

export async function createCategory(
  deps: { db: Database; now: () => Date },
  operator: OperatorRow,
  input: {
    code: string;
    name: string;
    description: string;
    capacity: number;
    isDevelopment: boolean;
    reason: string;
  },
) {
  const now = deps.now();
  const created = await transaction(deps.db, async (tx) => {
    const { rows } = await tx.query<CategoryRow>(
      `INSERT INTO mobility.vehicle_categories
         (code, name, description, capacity, status, is_development, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'inactive', $5, $6, $6)
       ON CONFLICT (code) DO NOTHING RETURNING *`,
      [
        input.code,
        input.name,
        input.description,
        input.capacity,
        input.isDevelopment,
        now,
      ],
    );
    if (!rows[0]) return null;
    await categoryEvent(tx, {
      categoryId: rows[0].id,
      operator,
      action: "created",
      reason: input.reason,
      snapshot: snapshot(rows[0]),
      now,
    });
    return rows[0];
  });
  await audit(deps.db, {
    operator,
    action: "vehicle_category_create",
    targetType: "vehicle_category",
    targetId: created?.id ?? null,
    reason: input.reason,
    result: created ? "succeeded" : "failed",
    detail: created ? { code: input.code } : { error: "CODE_TAKEN" },
  });
  if (!created) {
    throw new ApiError(
      409,
      "CODE_TAKEN",
      "Another vehicle category already uses this code.",
    );
  }
  return created;
}

export async function updateCategory(
  deps: { db: Database; now: () => Date },
  operator: OperatorRow,
  id: string,
  input: {
    name?: string;
    description?: string;
    capacity?: number;
    status?: "active" | "inactive";
    isDevelopment?: boolean;
    expectedVersion: number;
    reason: string;
  },
) {
  const now = deps.now();
  const outcome = await transaction(deps.db, async (tx) => {
    const { rows } = await tx.query<CategoryRow>(
      "SELECT * FROM mobility.vehicle_categories WHERE id = $1 FOR UPDATE",
      [id],
    );
    const before = rows[0];
    if (!before) return { error: "NOT_FOUND" as const };
    if (before.version !== input.expectedVersion) {
      return { error: "VERSION_CONFLICT" as const };
    }
    const { rows: updated } = await tx.query<CategoryRow>(
      `UPDATE mobility.vehicle_categories
          SET name = COALESCE($2, name), description = COALESCE($3, description),
              capacity = COALESCE($4, capacity), status = COALESCE($5, status),
              is_development = COALESCE($6, is_development),
              version = version + 1, updated_at = $7
        WHERE id = $1 RETURNING *`,
      [
        id,
        input.name ?? null,
        input.description ?? null,
        input.capacity ?? null,
        input.status ?? null,
        input.isDevelopment ?? null,
        now,
      ],
    );
    const action =
      input.status && input.status !== before.status
        ? input.status === "active"
          ? "activated"
          : "deactivated"
        : "updated";
    await categoryEvent(tx, {
      categoryId: id,
      operator,
      action,
      reason: input.reason,
      snapshot: { before: snapshot(before), after: snapshot(updated[0]) },
      now,
    });
    return { ok: updated[0], action };
  });
  await audit(deps.db, {
    operator,
    action: "vehicle_category_update",
    targetType: "vehicle_category",
    targetId: id,
    reason: input.reason,
    result: "error" in outcome ? "failed" : "succeeded",
    detail:
      "error" in outcome
        ? { error: outcome.error }
        : { action: outcome.action, version: outcome.ok.version },
  });
  if ("error" in outcome) {
    if (outcome.error === "NOT_FOUND") throw notFound("Vehicle category");
    throw new ApiError(
      409,
      "VERSION_CONFLICT",
      "This category changed since you opened it. Reload and try again.",
    );
  }
  return outcome.ok;
}

export async function categoriesForArea(
  db: SqlClient,
  serviceAreaId: string,
  now: Date,
): Promise<Omit<CategoryOption, "driversNearby">[]> {
  const { rows } = await db.query<CategoryRow>(
    `SELECT c.* FROM mobility.vehicle_categories c
      WHERE c.status = 'active'
        AND EXISTS (SELECT 1 FROM mobility.fare_policies fp
                     WHERE fp.service_area_id = $1 AND fp.vehicle_category_id = c.id
                       AND fp.status = 'scheduled' AND fp.effective_from <= $2)
      ORDER BY c.is_default DESC, c.capacity, c.name`,
    [serviceAreaId, now],
  );
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    capacity: c.capacity,
    isDevelopment: c.is_development,
  }));
}

export { DEFAULT_VEHICLE_CATEGORY_ID };
