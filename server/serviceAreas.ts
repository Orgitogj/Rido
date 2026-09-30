import {
  BOUNDARY_PROBLEM_TEXT,
  boundaryProblem,
  boundingBox,
  containsPoint,
  type Vertex,
} from "../shared/serviceArea";

import { type Database, type SqlClient, transaction } from "./db";
import { ApiError, notFound } from "./errors";
import {
  areaEvent,
  type FarePolicyRow,
  policyStates,
  policyView,
} from "./fares";
import { audit, type OperatorRow } from "./operators";

import type {
  DropoffRule,
  ServiceAreaDetail,
  ServiceAreaItem,
} from "../shared/adminPricing";

export interface ServiceAreaRow {
  id: string;
  code: string;
  name: string;
  status: "active" | "inactive";
  boundary: Vertex[];
  min_latitude: number;
  max_latitude: number;
  min_longitude: number;
  max_longitude: number;
  dropoff_rule: DropoffRule;
  is_development: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface Point {
  latitude: number;
  longitude: number;
}

export async function activeAreasContaining(
  db: SqlClient,
  point: Point,
): Promise<ServiceAreaRow[]> {
  const { rows } = await db.query<ServiceAreaRow>(
    `SELECT * FROM mobility.service_areas
      WHERE status = 'active'
        AND $1 BETWEEN min_latitude AND max_latitude
        AND $2 BETWEEN min_longitude AND max_longitude
      ORDER BY created_at, id`,
    [point.latitude, point.longitude],
  );
  return rows.filter((a) => containsPoint(a.boundary, point));
}

export async function serviceAreaForTrip(
  db: SqlClient,
  pickup: Point,
  destination: Point,
): Promise<ServiceAreaRow> {
  const areas = await activeAreasContaining(db, pickup);
  if (!areas.length) {
    throw new ApiError(
      422,
      "PICKUP_OUTSIDE_SERVICE_AREA",
      "Rides aren't available from this pickup location yet. Choose a pickup inside a covered area.",
    );
  }
  const area =
    areas.find(
      (a) =>
        a.dropoff_rule === "anywhere" || containsPoint(a.boundary, destination),
    ) ?? null;
  if (!area) {
    throw new ApiError(
      422,
      "DESTINATION_OUTSIDE_SERVICE_AREA",
      "This destination is outside the area we serve from your pickup. Choose a destination inside the covered area.",
    );
  }
  return area;
}

const iso = (d: Date) => new Date(d).toISOString();

const snapshot = (a: ServiceAreaRow) => ({
  code: a.code,
  name: a.name,
  status: a.status,
  boundary: a.boundary,
  dropoffRule: a.dropoff_rule,
  isDevelopment: a.is_development,
  version: a.version,
});

type PolicyWithNames = FarePolicyRow & {
  created_by_name: string | null;
  cancelled_by_name: string | null;
  quotes_using: number;
};

async function areaPolicies(db: SqlClient, areaIds: string[]) {
  const { rows } = await db.query<PolicyWithNames>(
    `SELECT fp.*, c.display_name AS created_by_name, x.display_name AS cancelled_by_name,
            (SELECT count(*)::int FROM mobility.quotes q WHERE q.fare_policy_id = fp.id) AS quotes_using
       FROM mobility.fare_policies fp
       LEFT JOIN mobility.operators c ON c.id = fp.created_by
       LEFT JOIN mobility.operators x ON x.id = fp.cancelled_by
      WHERE fp.service_area_id = ANY($1::uuid[])
      ORDER BY fp.version DESC`,
    [areaIds],
  );
  return rows;
}

function item(
  a: ServiceAreaRow,
  policies: FarePolicyRow[],
  now: Date,
): ServiceAreaItem {
  const states = policyStates(policies, now);
  const current = policies.find((p) => states.get(p.id) === "in_effect");
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    status: a.status,
    dropoffRule: a.dropoff_rule,
    isDevelopment: a.is_development,
    version: a.version,
    vertexCount: a.boundary.length,
    currentPolicy: current
      ? {
          version: current.version,
          label: current.label,
          isDevelopment: current.is_development,
        }
      : null,
    updatedAt: iso(a.updated_at),
  };
}

export async function listServiceAreas(
  db: SqlClient,
  now: Date,
): Promise<ServiceAreaItem[]> {
  const { rows } = await db.query<ServiceAreaRow>(
    "SELECT * FROM mobility.service_areas ORDER BY status, code",
  );
  const policies = await areaPolicies(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((a) =>
    item(
      a,
      policies.filter((p) => p.service_area_id === a.id),
      now,
    ),
  );
}

export async function serviceAreaDetail(
  db: SqlClient,
  id: string,
  now: Date,
): Promise<ServiceAreaDetail> {
  const { rows } = await db.query<ServiceAreaRow>(
    "SELECT * FROM mobility.service_areas WHERE id = $1",
    [id],
  );
  const area = rows[0];
  if (!area) throw notFound("Service area");
  const policies = await areaPolicies(db, [id]);
  const states = policyStates(policies, now);
  const { rows: events } = await db.query<{
    action: string;
    actor: string;
    operator: string | null;
    reason: string | null;
    created_at: Date;
  }>(
    `SELECT e.action, e.actor, o.display_name AS operator, e.reason, e.created_at
       FROM mobility.service_area_events e
       LEFT JOIN mobility.operators o ON o.id = e.operator_id
      WHERE e.service_area_id = $1 ORDER BY e.id DESC LIMIT 100`,
    [id],
  );
  return {
    ...item(area, policies, now),
    boundary: area.boundary,
    bounds: {
      minLatitude: area.min_latitude,
      maxLatitude: area.max_latitude,
      minLongitude: area.min_longitude,
      maxLongitude: area.max_longitude,
    },
    policies: policies.map((p) => policyView(p, states.get(p.id)!)),
    history: events.map((e) => ({
      action: e.action,
      actor: e.actor,
      operator: e.operator,
      reason: e.reason,
      createdAt: iso(e.created_at),
    })),
  };
}

function checkBoundary(boundary: Vertex[]) {
  const problem = boundaryProblem(boundary);
  if (problem) {
    throw new ApiError(
      422,
      `BOUNDARY_${problem}`,
      BOUNDARY_PROBLEM_TEXT[problem],
    );
  }
  return boundingBox(boundary);
}

export async function createServiceArea(
  deps: { db: Database; now: () => Date },
  operator: OperatorRow | null,
  input: {
    code: string;
    name: string;
    boundary: Vertex[];
    dropoffRule: DropoffRule;
    isDevelopment: boolean;
    reason: string;
  },
) {
  const now = deps.now();
  let box;
  try {
    box = checkBoundary(input.boundary);
  } catch (e) {
    if (operator) {
      await audit(deps.db, {
        operator,
        action: "service_area_create",
        targetType: "service_area",
        targetId: null,
        reason: input.reason,
        result: "failed",
        detail: { error: e instanceof ApiError ? e.code : "invalid" },
      });
    }
    throw e;
  }
  const area = await transaction(deps.db, async (tx) => {
    const { rows } = await tx.query<ServiceAreaRow>(
      `INSERT INTO mobility.service_areas
         (code, name, status, boundary, min_latitude, max_latitude, min_longitude,
          max_longitude, dropoff_rule, is_development, created_by, updated_by,
          created_at, updated_at)
       VALUES ($1, $2, 'inactive', $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $11)
       ON CONFLICT (code) DO NOTHING
       RETURNING *`,
      [
        input.code,
        input.name,
        JSON.stringify(input.boundary),
        box.minLatitude,
        box.maxLatitude,
        box.minLongitude,
        box.maxLongitude,
        input.dropoffRule,
        input.isDevelopment,
        operator?.id ?? null,
        now,
      ],
    );
    if (!rows[0]) return null;
    await areaEvent(tx, {
      areaId: rows[0].id,
      operator,
      action: "created",
      reason: input.reason,
      snapshot: snapshot(rows[0]),
      now,
    });
    return rows[0];
  });
  if (operator) {
    await audit(deps.db, {
      operator,
      action: "service_area_create",
      targetType: "service_area",
      targetId: area?.id ?? null,
      reason: input.reason,
      result: area ? "succeeded" : "failed",
      detail: area ? { code: input.code } : { error: "CODE_TAKEN" },
    });
  }
  if (!area) {
    throw new ApiError(
      409,
      "CODE_TAKEN",
      "Another service area already uses this code.",
    );
  }
  return area;
}

export async function updateServiceArea(
  deps: { db: Database; now: () => Date },
  operator: OperatorRow,
  id: string,
  input: {
    name?: string;
    boundary?: Vertex[];
    dropoffRule?: DropoffRule;
    status?: "active" | "inactive";
    expectedVersion: number;
    reason: string;
  },
) {
  const now = deps.now();
  const fail = async (status: number, code: string, message: string) => {
    await audit(deps.db, {
      operator,
      action: "service_area_update",
      targetType: "service_area",
      targetId: id,
      reason: input.reason,
      result: "failed",
      detail: { error: code },
    });
    throw new ApiError(status, code, message);
  };
  let box = null;
  if (input.boundary) {
    const problem = boundaryProblem(input.boundary);
    if (problem) {
      return fail(422, `BOUNDARY_${problem}`, BOUNDARY_PROBLEM_TEXT[problem]);
    }
    box = boundingBox(input.boundary);
  }
  const outcome = await transaction(deps.db, async (tx) => {
    const { rows } = await tx.query<ServiceAreaRow>(
      "SELECT * FROM mobility.service_areas WHERE id = $1 FOR UPDATE",
      [id],
    );
    const area = rows[0];
    if (!area)
      return { error: [404, "NOT_FOUND", "Service area not found."] as const };
    if (area.version !== input.expectedVersion) {
      return {
        error: [
          409,
          "VERSION_CONFLICT",
          "This area changed since you opened it. Reload and try again.",
        ] as const,
      };
    }
    if (input.status === "active" && area.status !== "active") {
      const { rows: policies } = await tx.query(
        "SELECT 1 FROM mobility.fare_policies WHERE service_area_id = $1 AND status = 'scheduled'",
        [id],
      );
      if (!policies.length) {
        return {
          error: [
            409,
            "NO_FARE_POLICY",
            "Add a fare policy before activating this area.",
          ] as const,
        };
      }
    }
    const { rows: updated } = await tx.query<ServiceAreaRow>(
      `UPDATE mobility.service_areas
          SET name = COALESCE($2, name),
              boundary = COALESCE($3::jsonb, boundary),
              min_latitude = COALESCE($4, min_latitude),
              max_latitude = COALESCE($5, max_latitude),
              min_longitude = COALESCE($6, min_longitude),
              max_longitude = COALESCE($7, max_longitude),
              dropoff_rule = COALESCE($8, dropoff_rule),
              status = COALESCE($9, status),
              version = version + 1, updated_by = $10, updated_at = $11
        WHERE id = $1 RETURNING *`,
      [
        id,
        input.name ?? null,
        input.boundary ? JSON.stringify(input.boundary) : null,
        box?.minLatitude ?? null,
        box?.maxLatitude ?? null,
        box?.minLongitude ?? null,
        box?.maxLongitude ?? null,
        input.dropoffRule ?? null,
        input.status ?? null,
        operator.id,
        now,
      ],
    );
    const changed = [
      input.name !== undefined && "name",
      input.boundary !== undefined && "boundary",
      input.dropoffRule !== undefined && "dropoff_rule",
      input.status !== undefined &&
        input.status !== area.status &&
        (input.status === "active" ? "activated" : "deactivated"),
    ].filter(Boolean) as string[];
    await areaEvent(tx, {
      areaId: id,
      operator,
      action: changed.length ? `updated:${changed.join(",")}` : "updated",
      reason: input.reason,
      snapshot: { before: snapshot(area), after: snapshot(updated[0]) },
      now,
    });
    return { ok: updated[0] };
  });
  if ("error" in outcome && outcome.error) {
    const [status, code, message] = outcome.error;
    return fail(status, code, message);
  }
  await audit(deps.db, {
    operator,
    action: "service_area_update",
    targetType: "service_area",
    targetId: id,
    reason: input.reason,
    result: "succeeded",
    detail: {
      version: outcome.ok!.version,
      status: outcome.ok!.status,
      boundaryChanged: input.boundary !== undefined,
    },
  });
  return outcome.ok!;
}
