import {
  type AdminSafetyItem,
  adminSafetyQuerySchema,
  messageReportSchema,
  type Page,
  rideIdSchema,
  safetyReportSchema,
  safetyTriageSchema,
  shareTokenSchema,
} from "../../shared/contracts";
import { type Deps, parseInput, readJson } from "../http";
import { audit, requireOperator } from "../operators";
import {
  createSafetyReport,
  getMyReport,
  listSafetyReports,
  reportChatMessage,
  safetyDetail,
  safetyView,
  triageSafetyReport,
} from "../safety";
import { createTripShare, revokeTripShare, viewSharedTrip } from "../shares";

import { decodeCursor, encodeCursor } from "./admin";
import { currentUser } from "./rides";

const query = (request: Request) =>
  Object.fromEntries(new URL(request.url).searchParams);

export async function getSafety(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const rideId = parseInput(rideIdSchema, params.id);
  return Response.json({ data: await safetyView(deps, user.id, rideId) });
}

export async function createReport(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const rideId = parseInput(rideIdSchema, params.id);
  const input = await readJson(request, safetyReportSchema);
  const { report, created } = await createSafetyReport(
    deps,
    user.id,
    rideId,
    input,
  );
  return Response.json({ data: report }, { status: created ? 201 : 200 });
}

export async function getReport(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const reportId = parseInput(rideIdSchema, params.id);
  return Response.json({ data: await getMyReport(deps.db, user.id, reportId) });
}

export async function reportMessage(
  request: Request,
  params: { id?: string; messageId?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const rideId = parseInput(rideIdSchema, params.id);
  const messageId = parseInput(rideIdSchema, params.messageId);
  const input = await readJson(request, messageReportSchema);
  const { report, created } = await reportChatMessage(
    deps,
    user.id,
    rideId,
    messageId,
    input,
  );
  return Response.json({ data: report }, { status: created ? 201 : 200 });
}

export async function createShare(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const rideId = parseInput(rideIdSchema, params.id);
  return Response.json(
    { data: await createTripShare(deps, user.id, rideId) },
    { status: 201 },
  );
}

export async function revokeShare(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await currentUser(request, deps);
  const shareId = parseInput(rideIdSchema, params.id);
  return Response.json({ data: await revokeTripShare(deps, user.id, shareId) });
}

export async function viewShare(
  _request: Request,
  params: { token?: string },
  deps: Deps,
) {
  const token = parseInput(shareTokenSchema, params.token);
  const response = Response.json({ data: await viewSharedTrip(deps, token) });
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex");
  return response;
}

export async function listSafety(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const operator = await requireOperator(request, deps, "support", {
    type: "safety_report",
    id: null,
    action: "safety_list",
  });
  const q = parseInput(adminSafetyQuerySchema, query(request));
  const rows = await listSafetyReports(deps.db, operator, {
    ...q,
    cursor: decodeCursor(q.cursor),
  });
  const more = rows.length > q.limit;
  const items = more ? rows.slice(0, q.limit) : rows;
  const last = items[items.length - 1];
  const body: Page<AdminSafetyItem> = {
    items: items.map((r) => r.item),
    nextCursor:
      more && last ? encodeCursor(last.row.created_at, last.row.id) : null,
  };
  return Response.json({ data: body });
}

export async function getSafetyReport(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const reportId = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "support", {
    type: "safety_report",
    id: reportId,
    action: "safety_view",
  });
  const detail = await safetyDetail(deps.db, reportId, operator);
  await audit(deps.db, {
    operator,
    action: "safety_view",
    targetType: "safety_report",
    targetId: reportId,
    result: "succeeded",
    detail: { rideId: detail.rideId, reportedMessages: detail.messages.length },
  });
  return Response.json({ data: detail });
}

export async function triageSafety(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const reportId = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "support", {
    type: "safety_report",
    id: reportId,
    action: "safety_triage",
  });
  const input = await readJson(request, safetyTriageSchema);
  await triageSafetyReport(deps, reportId, operator, input);
  return Response.json({
    data: await safetyDetail(deps.db, reportId, operator),
  });
}
