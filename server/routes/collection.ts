import {
  adminCollectionSchema,
  collectionRequestSchema,
  type DriverBalanceDetail,
  type DriverBalanceItem,
  rideIdSchema,
  settlementCreateSchema,
} from "../../shared/contracts";
import { appCurrency } from "../../shared/currency";
import {
  createSettlement,
  driverBalance,
  listDriverBalances,
  listSettlements,
  recordCollection,
} from "../collection";
import { transaction } from "../db";
import { ApiError, notFound } from "../errors";
import { type Deps, parseInput, readJson } from "../http";
import { audit, requireOperator } from "../operators";
import { rideView, withLockedRide } from "../rides";
import { ensureUser } from "../users";

export async function recordRideCollection(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await ensureUser(deps.db, await deps.authenticate(request));
  const rideId = parseInput(rideIdSchema, params.id);
  const { method } = await readJson(request, collectionRequestSchema);
  const { rows } = await deps.db.query<{ id: string }>(
    "SELECT id FROM mobility.driver_profiles WHERE user_id = $1",
    [user.id],
  );
  const profileId = rows[0]?.id;
  if (!profileId) throw notFound("Ride");
  await withLockedRide(deps, rideId, async (tx, ride) => {
    if (ride.driver_profile_id !== profileId) throw notFound("Ride");
    return recordCollection(tx, ride, {
      outcome: method,
      by: "driver",
      now: deps.now(),
    });
  });
  return Response.json({
    data: await rideView(deps.db, rideId, "driver", deps.now()),
  });
}

export async function adminRecordCollection(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const rideId = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "support", {
    type: "ride",
    id: rideId,
    action: "ride_collection",
  });
  const input = await readJson(request, adminCollectionSchema);
  try {
    await withLockedRide(deps, rideId, (tx, ride) =>
      recordCollection(tx, ride, {
        outcome: input.outcome,
        by: "operator",
        operatorId: operator.id,
        note: input.note,
        now: deps.now(),
      }),
    );
  } catch (error) {
    await audit(deps.db, {
      operator,
      action: "ride_collection",
      targetType: "ride",
      targetId: rideId,
      reason: input.note,
      result: "failed",
      detail: {
        outcome: input.outcome,
        error: error instanceof ApiError ? error.code : "error",
      },
    });
    throw error;
  }
  await audit(deps.db, {
    operator,
    action: "ride_collection",
    targetType: "ride",
    targetId: rideId,
    reason: input.note,
    result: "succeeded",
    detail: { outcome: input.outcome },
  });
  return Response.json({ data: { rideId, outcome: input.outcome } });
}

export async function listBalances(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  await requireOperator(request, deps, "refund", {
    type: "driver_settlement",
    id: null,
    action: "driver_balance_list",
  });
  const body: DriverBalanceItem[] = await listDriverBalances(
    deps.db,
    appCurrency(),
  );
  return Response.json({ data: body });
}

async function balanceDetail(
  deps: Deps,
  profileId: string,
): Promise<DriverBalanceDetail> {
  const { rows } = await deps.db.query<{ display_name: string }>(
    "SELECT display_name FROM mobility.driver_profiles WHERE id = $1",
    [profileId],
  );
  if (!rows[0]) throw notFound("Driver");
  return {
    driverProfileId: profileId,
    displayName: rows[0].display_name,
    balance: await driverBalance(deps.db, profileId, appCurrency()),
    settlements: await listSettlements(deps.db, profileId),
  };
}

export async function getBalance(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const profileId = parseInput(rideIdSchema, params.id);
  await requireOperator(request, deps, "refund", {
    type: "driver_settlement",
    id: profileId,
    action: "driver_balance_view",
  });
  return Response.json({ data: await balanceDetail(deps, profileId) });
}

export async function recordSettlement(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const profileId = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "refund", {
    type: "driver_settlement",
    id: profileId,
    action: "driver_settlement_create",
  });
  const input = await readJson(request, settlementCreateSchema);
  const currency = appCurrency();
  if (currency === "all" && input.amountCents % 100 !== 0) {
    throw new ApiError(
      400,
      "INVALID_INPUT",
      "Amounts in lek must be whole lek.",
    );
  }
  const { created } = await transaction(deps.db, (tx) =>
    createSettlement(tx, {
      profileId,
      direction: input.direction,
      amountCents: input.amountCents,
      currency,
      method: input.method,
      reference: input.reference || null,
      note: input.note || null,
      operatorId: operator.id,
      idempotencyKey: input.idempotencyKey,
      now: deps.now(),
    }),
  );
  if (created) {
    await audit(deps.db, {
      operator,
      action: "driver_settlement_create",
      targetType: "driver_settlement",
      targetId: profileId,
      reason: input.note ?? null,
      result: "succeeded",
      detail: {
        direction: input.direction,
        amountCents: input.amountCents,
        currency,
        method: input.method,
      },
    });
  }
  return Response.json(
    { data: await balanceDetail(deps, profileId) },
    { status: created ? 201 : 200 },
  );
}
