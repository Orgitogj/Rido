import { ApiError } from "./errors";
import { ensureUser } from "./users";

import type { SqlClient } from "./db";
import type { Deps } from "./http";
import type { OperatorPermission } from "../shared/contracts";

export interface OperatorRow {
  id: string;
  user_id: string;
  clerk_id: string;
  display_name: string;
  can_view: boolean;
  can_support: boolean;
  can_refund: boolean;
}

export const permissionsOf = (o: OperatorRow): OperatorPermission[] =>
  [
    o.can_view ? "view" : null,
    o.can_support ? "support" : null,
    o.can_refund ? "refund" : null,
  ].filter((p): p is OperatorPermission => p !== null);

export const actorOf = (o: OperatorRow) => `operator:${o.clerk_id}`;

const SENSITIVE_KEY =
  /token|secret|password|card|cvc|email|phone|latitude|longitude|location|client_secret|authorization/i;

export function sanitizeDetail(value: unknown, depth = 0): unknown {
  if (depth > 3) return null;
  if (typeof value === "string") return value.slice(0, 200);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => sanitizeDetail(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) continue;
      out[key] = sanitizeDetail(v, depth + 1);
    }
    return out;
  }
  return null;
}

export async function audit(
  db: SqlClient,
  entry: {
    operator: OperatorRow | null;
    actor?: string;
    action: string;
    targetType: string;
    targetId: string | null;
    reason?: string | null;
    result: "succeeded" | "failed" | "denied" | "pending";
    detail?: Record<string, unknown>;
  },
) {
  await db.query(
    `INSERT INTO mobility.audit_log
       (operator_id, actor, action, target_type, target_id, reason, result, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      entry.operator?.id ?? null,
      (
        entry.actor ?? (entry.operator ? actorOf(entry.operator) : "unknown")
      ).slice(0, 120),
      entry.action,
      entry.targetType,
      entry.targetId,
      entry.reason ? entry.reason.slice(0, 500) : null,
      entry.result,
      JSON.stringify(sanitizeDetail(entry.detail ?? {})),
    ],
  );
}

export async function requireOperator(
  request: Request,
  deps: Deps,
  permission: OperatorPermission,
  target: { type: string; id: string | null; action: string } = {
    type: "console",
    id: null,
    action: "access",
  },
): Promise<OperatorRow> {
  const identity = await deps.authenticate(request);
  const user = await ensureUser(deps.db, identity);
  const { rows } = await deps.db.query<OperatorRow>(
    `SELECT o.id, o.user_id, u.clerk_id, o.display_name,
            o.can_view, o.can_support, o.can_refund
       FROM mobility.operators o JOIN mobility.users u ON u.id = o.user_id
      WHERE o.user_id = $1 AND o.active`,
    [user.id],
  );
  const operator = rows[0];
  if (!operator) {
    await audit(deps.db, {
      operator: null,
      actor: `user:${identity.clerkId}`,
      action: `${target.action}_denied`,
      targetType: target.type,
      targetId: target.id,
      result: "denied",
      detail: { reason: "not_an_operator" },
    });
    throw new ApiError(
      403,
      "NOT_AN_OPERATOR",
      "This account is not an operator.",
    );
  }
  if (!permissionsOf(operator).includes(permission)) {
    await audit(deps.db, {
      operator,
      action: `${target.action}_denied`,
      targetType: target.type,
      targetId: target.id,
      result: "denied",
      detail: { missingPermission: permission },
    });
    throw new ApiError(
      403,
      "PERMISSION_DENIED",
      `This action needs the "${permission}" permission.`,
    );
  }
  return operator;
}
