import {
  type AdminDriverItem,
  adminDriverQuerySchema,
  driverDecisionSchema,
  type Page,
  rideIdSchema,
} from "../../shared/contracts";
import { driverCategoriesSchema } from "../../shared/vehicleCategory";
import { type Deps, parseInput, readJson } from "../http";
import { requireOperator } from "../operators";
import {
  applicationDetail,
  decideApplication,
  documentAccess,
  listApplications,
  setDriverCategories,
} from "../verification";

import { decodeCursor, encodeCursor } from "./admin";

const query = (request: Request) =>
  Object.fromEntries(new URL(request.url).searchParams);

export async function listDriverApplications(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  await requireOperator(request, deps, "verify", {
    type: "driver_profile",
    id: null,
    action: "driver_list",
  });
  const q = parseInput(adminDriverQuerySchema, query(request));
  const rows = await listApplications(
    deps.db,
    { status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit },
    deps.now(),
  );
  const more = rows.length > q.limit;
  const items = more ? rows.slice(0, q.limit) : rows;
  const last = items[items.length - 1];
  const body: Page<AdminDriverItem> = {
    items: items.map((r) => r.item),
    nextCursor:
      more && last ? encodeCursor(last.row.updated_at, last.row.id) : null,
  };
  return Response.json({ data: body });
}

export async function getDriverApplication(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const profileId = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "verify", {
    type: "driver_profile",
    id: profileId,
    action: "driver_view",
  });
  return Response.json({
    data: await applicationDetail(deps.db, profileId, operator, deps.now()),
  });
}

export async function accessDriverDocument(
  request: Request,
  params: { id?: string; documentId?: string },
  deps: Deps,
) {
  const profileId = parseInput(rideIdSchema, params.id);
  const documentId = parseInput(rideIdSchema, params.documentId);
  const operator = await requireOperator(request, deps, "verify", {
    type: "driver_profile",
    id: profileId,
    action: "driver_document_access",
  });
  return Response.json({
    data: await documentAccess(deps, operator, profileId, documentId),
  });
}

export async function decideDriverApplication(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const profileId = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "verify", {
    type: "driver_profile",
    id: profileId,
    action: "driver_decision",
  });
  const input = await readJson(request, driverDecisionSchema);
  await decideApplication(deps, profileId, operator, input);
  return Response.json({
    data: await applicationDetail(deps.db, profileId, operator, deps.now()),
  });
}

export async function changeDriverCategories(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const profileId = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "verify", {
    type: "driver_profile",
    id: profileId,
    action: "driver_categories",
  });
  const input = await readJson(request, driverCategoriesSchema);
  await setDriverCategories(deps, profileId, operator, input);
  return Response.json({
    data: await applicationDetail(deps.db, profileId, operator, deps.now()),
  });
}
