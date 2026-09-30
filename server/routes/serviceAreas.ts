import {
  farePolicyCancelSchema,
  farePolicyCreateSchema,
  serviceAreaCreateSchema,
  serviceAreaUpdateSchema,
} from "../../shared/adminPricing";
import { rideIdSchema } from "../../shared/contracts";
import { cancelFarePolicy, createFarePolicy } from "../fares";
import { type Deps, parseInput, readJson } from "../http";
import { requireOperator } from "../operators";
import {
  createServiceArea,
  listServiceAreas,
  serviceAreaDetail,
  updateServiceArea,
} from "../serviceAreas";

import type { Vertex } from "../../shared/serviceArea";

export async function listAreas(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  await requireOperator(request, deps, "configure", {
    type: "service_area",
    id: null,
    action: "service_area_list",
  });
  return Response.json({ data: await listServiceAreas(deps.db, deps.now()) });
}

export async function getArea(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const id = parseInput(rideIdSchema, params.id);
  await requireOperator(request, deps, "configure", {
    type: "service_area",
    id,
    action: "service_area_view",
  });
  return Response.json({
    data: await serviceAreaDetail(deps.db, id, deps.now()),
  });
}

export async function createArea(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const operator = await requireOperator(request, deps, "configure", {
    type: "service_area",
    id: null,
    action: "service_area_create",
  });
  const input = await readJson(request, serviceAreaCreateSchema);
  const area = await createServiceArea(deps, operator, {
    ...input,
    boundary: input.boundary as Vertex[],
  });
  return Response.json(
    { data: await serviceAreaDetail(deps.db, area.id, deps.now()) },
    { status: 201 },
  );
}

export async function updateArea(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const id = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "configure", {
    type: "service_area",
    id,
    action: "service_area_update",
  });
  const input = await readJson(request, serviceAreaUpdateSchema);
  await updateServiceArea(deps, operator, id, {
    ...input,
    boundary: input.boundary as Vertex[] | undefined,
  });
  return Response.json({
    data: await serviceAreaDetail(deps.db, id, deps.now()),
  });
}

export async function createPolicy(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const id = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "configure", {
    type: "service_area",
    id,
    action: "fare_policy_create",
  });
  const input = await readJson(request, farePolicyCreateSchema);
  await createFarePolicy(deps, operator, id, input);
  return Response.json(
    { data: await serviceAreaDetail(deps.db, id, deps.now()) },
    { status: 201 },
  );
}

export async function cancelPolicy(
  request: Request,
  params: { id?: string; policyId?: string },
  deps: Deps,
) {
  const id = parseInput(rideIdSchema, params.id);
  const policyId = parseInput(rideIdSchema, params.policyId);
  const operator = await requireOperator(request, deps, "configure", {
    type: "service_area",
    id,
    action: "fare_policy_cancel",
  });
  const { reason } = await readJson(request, farePolicyCancelSchema);
  await cancelFarePolicy(deps, operator, id, policyId, reason);
  return Response.json({
    data: await serviceAreaDetail(deps.db, id, deps.now()),
  });
}
