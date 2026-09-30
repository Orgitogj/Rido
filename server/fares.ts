import { type Database, type SqlClient, transaction } from "./db";
import { ApiError, notFound } from "./errors";
import { audit, type OperatorRow } from "./operators";

import type { FarePolicyState, FarePolicyView } from "../shared/adminPricing";

export interface FarePolicyRow {
  id: string;
  service_area_id: string;
  version: number;
  label: string;
  is_development: boolean;
  currency: string;
  base_cents: number;
  per_km_cents: number;
  per_minute_cents: number;
  minimum_fare_cents: number;
  effective_from: Date;
  status: "scheduled" | "cancelled";
  reason: string;
  created_by: string | null;
  created_at: Date;
  cancelled_by: string | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
}

export interface FareBreakdown {
  baseCents: number;
  distanceCents: number;
  timeCents: number;
  minimumApplied: boolean;
  totalCents: number;
}

export const FARE_EXAMPLES = [
  { distanceMeters: 3000, durationSeconds: 600 },
  { distanceMeters: 10_000, durationSeconds: 1500 },
] as const;

export function roundHalfUp(numerator: number, denominator: number) {
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator < 0 ||
    denominator <= 0
  ) {
    throw new Error("roundHalfUp needs non-negative safe integers");
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export function computeFare(
  policy: Pick<
    FarePolicyRow,
    "base_cents" | "per_km_cents" | "per_minute_cents" | "minimum_fare_cents"
  >,
  route: { distanceMeters: number; durationSeconds: number },
): FareBreakdown {
  const distanceCents = roundHalfUp(
    route.distanceMeters * policy.per_km_cents,
    1000,
  );
  const timeCents = roundHalfUp(
    route.durationSeconds * policy.per_minute_cents,
    60,
  );
  const subtotal = policy.base_cents + distanceCents + timeCents;
  return {
    baseCents: policy.base_cents,
    distanceCents,
    timeCents,
    minimumApplied: subtotal < policy.minimum_fare_cents,
    totalCents: Math.max(subtotal, policy.minimum_fare_cents),
  };
}

export const pricingVersion = (areaCode: string, version: number) =>
  `${areaCode}/v${version}`;

export async function effectivePolicy(
  db: SqlClient,
  serviceAreaId: string,
  at: Date,
): Promise<FarePolicyRow | null> {
  const { rows } = await db.query<FarePolicyRow>(
    `SELECT * FROM mobility.fare_policies
      WHERE service_area_id = $1 AND status = 'scheduled' AND effective_from <= $2
      ORDER BY effective_from DESC, version DESC
      LIMIT 1`,
    [serviceAreaId, at],
  );
  return rows[0] ?? null;
}

export function policyStates(
  policies: FarePolicyRow[],
  now: Date,
): Map<string, FarePolicyState> {
  const states = new Map<string, FarePolicyState>();
  const live = policies
    .filter((p) => p.status === "scheduled")
    .sort(
      (a, b) =>
        new Date(b.effective_from).getTime() -
          new Date(a.effective_from).getTime() || b.version - a.version,
    );
  const current = live.find((p) => new Date(p.effective_from) <= now);
  for (const p of policies) {
    if (p.status === "cancelled") states.set(p.id, "cancelled");
    else if (new Date(p.effective_from) > now) states.set(p.id, "scheduled");
    else states.set(p.id, p.id === current?.id ? "in_effect" : "superseded");
  }
  return states;
}

export function policyView(
  p: FarePolicyRow & {
    created_by_name?: string | null;
    cancelled_by_name?: string | null;
    quotes_using?: number;
  },
  state: FarePolicyState,
): FarePolicyView {
  return {
    id: p.id,
    version: p.version,
    label: p.label,
    isDevelopment: p.is_development,
    currency: p.currency.trim(),
    baseCents: p.base_cents,
    perKmCents: p.per_km_cents,
    perMinuteCents: p.per_minute_cents,
    minimumFareCents: p.minimum_fare_cents,
    effectiveFrom: new Date(p.effective_from).toISOString(),
    state,
    reason: p.reason,
    createdBy: p.created_by_name ?? null,
    createdAt: new Date(p.created_at).toISOString(),
    cancelledBy: p.cancelled_by_name ?? null,
    cancelReason: p.cancel_reason,
    quotesUsing: p.quotes_using ?? 0,
    examples: FARE_EXAMPLES.map((e) => ({
      ...e,
      fareCents: computeFare(p, e).totalCents,
    })),
  };
}

async function areaEvent(
  tx: SqlClient,
  e: {
    areaId: string;
    operator: OperatorRow | null;
    action: string;
    reason: string;
    snapshot: unknown;
    now: Date;
  },
) {
  await tx.query(
    `INSERT INTO mobility.service_area_events
       (service_area_id, actor, operator_id, action, reason, snapshot, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      e.areaId,
      e.operator ? "operator" : "system",
      e.operator?.id ?? null,
      e.action,
      e.reason,
      JSON.stringify(e.snapshot),
      e.now,
    ],
  );
}

export { areaEvent };

export async function createFarePolicy(
  deps: { db: Database; now: () => Date },
  operator: OperatorRow,
  serviceAreaId: string,
  input: {
    label: string;
    isDevelopment: boolean;
    baseCents: number;
    perKmCents: number;
    perMinuteCents: number;
    minimumFareCents: number;
    effectiveFrom: string;
    reason: string;
  },
) {
  const now = deps.now();
  const effectiveFrom = new Date(input.effectiveFrom);
  const refuse = async (status: number, code: string, message: string) => {
    await audit(deps.db, {
      operator,
      action: "fare_policy_create",
      targetType: "service_area",
      targetId: serviceAreaId,
      reason: input.reason,
      result: "failed",
      detail: { error: code },
    });
    throw new ApiError(status, code, message);
  };
  if (effectiveFrom.getTime() < now.getTime() - 60_000) {
    return refuse(
      422,
      "EFFECTIVE_DATE_IN_PAST",
      "A new policy can't take effect in the past. Existing quotes and rides keep their original price.",
    );
  }
  const created = await transaction(deps.db, async (tx) => {
    const { rows: areas } = await tx.query<{ id: string; code: string }>(
      "SELECT id, code FROM mobility.service_areas WHERE id = $1 FOR UPDATE",
      [serviceAreaId],
    );
    if (!areas[0]) return null;
    const { rows } = await tx.query<FarePolicyRow>(
      `INSERT INTO mobility.fare_policies
         (service_area_id, version, label, is_development, base_cents, per_km_cents,
          per_minute_cents, minimum_fare_cents, effective_from, reason, created_by, created_at)
       SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
         FROM mobility.fare_policies WHERE service_area_id = $1
       RETURNING *`,
      [
        serviceAreaId,
        input.label,
        input.isDevelopment,
        input.baseCents,
        input.perKmCents,
        input.perMinuteCents,
        input.minimumFareCents,
        effectiveFrom < now ? now : effectiveFrom,
        input.reason,
        operator.id,
        now,
      ],
    );
    await areaEvent(tx, {
      areaId: serviceAreaId,
      operator,
      action: "fare_policy_created",
      reason: input.reason,
      snapshot: { policyId: rows[0].id, version: rows[0].version, ...input },
      now,
    });
    return { policy: rows[0], code: areas[0].code };
  });
  if (!created) throw notFound("Service area");
  await audit(deps.db, {
    operator,
    action: "fare_policy_create",
    targetType: "service_area",
    targetId: serviceAreaId,
    reason: input.reason,
    result: "succeeded",
    detail: {
      policyId: created.policy.id,
      version: created.policy.version,
      effectiveFrom: new Date(created.policy.effective_from).toISOString(),
      isDevelopment: input.isDevelopment,
    },
  });
  return created.policy;
}

export async function cancelFarePolicy(
  deps: { db: Database; now: () => Date },
  operator: OperatorRow,
  serviceAreaId: string,
  policyId: string,
  reason: string,
) {
  const now = deps.now();
  const outcome = await transaction(deps.db, async (tx) => {
    const { rows } = await tx.query<FarePolicyRow>(
      `SELECT * FROM mobility.fare_policies
        WHERE id = $1 AND service_area_id = $2 FOR UPDATE`,
      [policyId, serviceAreaId],
    );
    const policy = rows[0];
    if (!policy)
      return { error: [404, "NOT_FOUND", "Fare policy not found."] as const };
    if (policy.status === "cancelled") return { ok: policy };
    if (new Date(policy.effective_from) <= now) {
      return {
        error: [
          409,
          "POLICY_ALREADY_EFFECTIVE",
          "This policy is already in effect. Schedule a new version instead; quotes and rides keep the price they were given.",
        ] as const,
      };
    }
    const { rows: done } = await tx.query<FarePolicyRow>(
      `UPDATE mobility.fare_policies
          SET status = 'cancelled', cancelled_by = $2, cancelled_at = $3, cancel_reason = $4
        WHERE id = $1 RETURNING *`,
      [policy.id, operator.id, now, reason],
    );
    await areaEvent(tx, {
      areaId: serviceAreaId,
      operator,
      action: "fare_policy_cancelled",
      reason,
      snapshot: { policyId: policy.id, version: policy.version },
      now,
    });
    return { ok: done[0] };
  });
  await audit(deps.db, {
    operator,
    action: "fare_policy_cancel",
    targetType: "service_area",
    targetId: serviceAreaId,
    reason,
    result: "error" in outcome ? "failed" : "succeeded",
    detail: {
      policyId,
      ...("error" in outcome && outcome.error
        ? { error: outcome.error[1] }
        : {}),
    },
  });
  if ("error" in outcome && outcome.error) {
    const [status, code, message] = outcome.error;
    throw new ApiError(status, code, message);
  }
  return outcome.ok;
}
