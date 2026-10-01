import {
  type AdminSafetyDetail,
  type AdminSafetyItem,
  type MySafetyReport,
  type RideStatus,
  SAFETY_RULES,
  type SafetyCategory,
  type SafetyReportStatus,
  type SafetyView,
} from "../shared/contracts";

import { chatAccess, findVisibleMessage, type MessageRow } from "./chat";
import { type Database, type SqlClient, transaction } from "./db";
import { ApiError, notFound } from "./errors";
import { TERMINAL_STATUSES } from "./lifecycle";
import { enqueueNotification } from "./notifications";
import { NOTIFY } from "./notificationText";
import { audit, type OperatorRow } from "./operators";
import { listShares, SHAREABLE_STATUSES } from "./shares";

const DAY_MS = 24 * 3600 * 1000;
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
const maskAccount = (clerkId: string) => `user_…${clerkId.slice(-4)}`;

interface ParticipantRide {
  id: string;
  user_id: string;
  status: RideStatus;
  driver_profile_id: string | null;
  driver_user_id: string | null;
  demo_driver_id: number | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  interrupted_at: Date | null;
  driver_name: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_plate: string | null;
  passenger_name: string | null;
}

export interface Participant {
  ride: ParticipantRide;
  role: "passenger" | "driver";
  driverProfileId: string | null;
  current: boolean;
  leftAt: Date | null;
}

export async function safetyParticipant(
  db: SqlClient,
  userId: string,
  rideId: string,
): Promise<Participant> {
  const { rows } = await db.query<ParticipantRide>(
    `SELECT r.id, r.user_id, r.status, r.driver_profile_id, dp.user_id AS driver_user_id,
            r.demo_driver_id, r.completed_at, r.cancelled_at, r.interrupted_at,
            dp.display_name AS driver_name, dp.vehicle_make, dp.vehicle_model,
            dp.vehicle_plate, COALESCE(r.passenger_name, u.name) AS passenger_name
       FROM mobility.rides r
       JOIN mobility.users u ON u.id = r.user_id
       LEFT JOIN mobility.driver_profiles dp ON dp.id = r.driver_profile_id
      WHERE r.id = $1`,
    [rideId],
  );
  const ride = rows[0];
  if (!ride) throw notFound("Ride");
  if (ride.user_id === userId) {
    return {
      ride,
      role: "passenger",
      driverProfileId: null,
      current: true,
      leftAt: null,
    };
  }
  if (ride.driver_user_id === userId) {
    return {
      ride,
      role: "driver",
      driverProfileId: ride.driver_profile_id,
      current: true,
      leftAt: null,
    };
  }
  const { rows: former } = await db.query<{
    profile_id: string;
    left_at: Date;
  }>(
    `SELECT dp.id AS profile_id, e.created_at AS left_at
       FROM mobility.ride_events e
       JOIN mobility.driver_profiles dp ON dp.user_id = e.actor_user_id
      WHERE e.ride_id = $1 AND e.actor = 'driver' AND e.actor_user_id = $2
        AND e.from_status = ANY($3::text[]) AND e.to_status IN ('requested', 'cancelled')
      ORDER BY e.created_at DESC LIMIT 1`,
    [rideId, userId, ["accepted", "arriving", "arrived"]],
  );
  if (former[0]) {
    return {
      ride,
      role: "driver",
      driverProfileId: former[0].profile_id,
      current: false,
      leftAt: new Date(former[0].left_at),
    };
  }
  throw notFound("Ride");
}

function endedAt(ride: ParticipantRide): Date | null {
  if (!TERMINAL_STATUSES.includes(ride.status)) return null;
  const at = ride.completed_at ?? ride.interrupted_at ?? ride.cancelled_at;
  return at ? new Date(at) : null;
}

export function reportWindow(p: Participant, now: Date) {
  if (p.ride.status === "legacy" || p.ride.demo_driver_id !== null) {
    return { canReport: false, reportBy: null as Date | null };
  }
  const from = p.current ? endedAt(p.ride) : p.leftAt;
  if (!from) return { canReport: true, reportBy: null as Date | null };
  const reportBy = new Date(
    from.getTime() + SAFETY_RULES.reportWindowDays * DAY_MS,
  );
  return { canReport: now.getTime() <= reportBy.getTime(), reportBy };
}

interface ReportRow {
  id: string;
  ride_id: string;
  reporter_user_id: string;
  reporter_role: "passenger" | "driver";
  client_report_id: string;
  category: SafetyCategory;
  description: string;
  status: SafetyReportStatus;
  assigned_operator_id: string | null;
  resolution_note: string | null;
  version: number;
  evidence_retained_until: Date | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  message_count?: number;
}

const myReport = (r: ReportRow): MySafetyReport => ({
  id: r.id,
  rideId: r.ride_id,
  category: r.category,
  status: r.status,
  reportedMessages: Number(r.message_count ?? 0),
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
  closedAt: iso(r.closed_at),
});

const REPORT_SQL = `
  SELECT s.*, (SELECT count(*)::int FROM mobility.safety_report_messages m
                WHERE m.report_id = s.id) AS message_count
    FROM mobility.safety_reports s`;

async function attachMessage(
  tx: SqlClient,
  reportId: string,
  message: MessageRow,
  now: Date,
) {
  const { rows } = await tx.query(
    `INSERT INTO mobility.safety_report_messages
       (report_id, message_id, ride_id, message_seq, sender_role, snapshot_body,
        message_created_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (report_id, message_id) DO NOTHING
     RETURNING id`,
    [
      reportId,
      message.id,
      message.ride_id,
      message.seq,
      message.sender_role,
      message.body.slice(0, 500),
      message.created_at,
      now,
    ],
  );
  if (rows.length) {
    await tx.query(
      `INSERT INTO mobility.safety_report_events (report_id, actor, action, created_at)
       VALUES ($1, 'reporter', 'message_attached', $2)`,
      [reportId, now],
    );
  }
}

export async function createSafetyReport(
  deps: { db: Database; now: () => Date },
  userId: string,
  rideId: string,
  input: {
    category: SafetyCategory;
    description: string;
    clientReportId: string;
  },
  message: MessageRow | null = null,
): Promise<{ report: MySafetyReport; created: boolean }> {
  const now = deps.now();
  return transaction(deps.db, async (tx) => {
    const p = await safetyParticipant(tx, userId, rideId);
    const { rows: existing } = await tx.query<ReportRow>(
      "SELECT * FROM mobility.safety_reports WHERE reporter_user_id = $1 AND client_report_id = $2",
      [userId, input.clientReportId],
    );
    if (existing[0]) {
      if (
        existing[0].ride_id !== rideId ||
        existing[0].category !== input.category
      ) {
        throw new ApiError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This report ID was already used for a different report.",
        );
      }
      if (message) await attachMessage(tx, existing[0].id, message, now);
      return { report: await loadMine(tx, existing[0].id), created: false };
    }
    const { canReport } = reportWindow(p, now);
    if (!canReport) {
      throw new ApiError(
        409,
        "REPORT_WINDOW_CLOSED",
        `Safety reports can be sent up to ${SAFETY_RULES.reportWindowDays} days after a ride. Contact support for anything older.`,
      );
    }
    const { rows } = await tx.query<ReportRow>(
      `INSERT INTO mobility.safety_reports
         (ride_id, reporter_user_id, reporter_role, reporter_driver_profile_id,
          client_report_id, category, description, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       ON CONFLICT (reporter_user_id, client_report_id) DO NOTHING
       RETURNING *`,
      [
        rideId,
        userId,
        p.role,
        p.role === "driver" ? p.driverProfileId : null,
        input.clientReportId,
        input.category,
        input.description,
        now,
      ],
    );
    if (!rows[0]) throw new ApiError(409, "RETRY", "Please try again.");
    await tx.query(
      `INSERT INTO mobility.safety_report_events (report_id, actor, action, to_status, created_at)
       VALUES ($1, 'reporter', 'created', 'open', $2)`,
      [rows[0].id, now],
    );
    if (message) await attachMessage(tx, rows[0].id, message, now);
    return { report: await loadMine(tx, rows[0].id), created: true };
  });
}

async function loadMine(db: SqlClient, reportId: string) {
  const { rows } = await db.query<ReportRow>(`${REPORT_SQL} WHERE s.id = $1`, [
    reportId,
  ]);
  return myReport(rows[0]);
}

export async function reportChatMessage(
  deps: { db: Database; now: () => Date },
  userId: string,
  rideId: string,
  messageId: string,
  input: {
    category: SafetyCategory;
    description?: string;
    clientReportId: string;
  },
) {
  const access = await chatAccess(deps.db, userId, rideId);
  const message = await findVisibleMessage(
    deps.db,
    access,
    messageId,
    deps.now(),
  );
  if (!message) throw notFound("Message");
  if (message.sender_user_id === userId) {
    throw new ApiError(
      422,
      "CANNOT_REPORT_OWN_MESSAGE",
      "You can only report messages you received.",
    );
  }
  return createSafetyReport(
    deps,
    userId,
    rideId,
    {
      category: input.category,
      description: input.description ?? "Reported a chat message.",
      clientReportId: input.clientReportId,
    },
    message,
  );
}

export async function getMyReport(
  db: SqlClient,
  userId: string,
  reportId: string,
) {
  const { rows } = await db.query<ReportRow>(
    `${REPORT_SQL} WHERE s.id = $1 AND s.reporter_user_id = $2`,
    [reportId, userId],
  );
  if (!rows[0]) throw notFound("Report");
  return myReport(rows[0]);
}

export async function safetyView(
  deps: { db: Database; now: () => Date },
  userId: string,
  rideId: string,
): Promise<SafetyView> {
  const now = deps.now();
  const p = await safetyParticipant(deps.db, userId, rideId);
  const { canReport, reportBy } = reportWindow(p, now);
  const { rows } = await deps.db.query<ReportRow>(
    `${REPORT_SQL} WHERE s.ride_id = $1 AND s.reporter_user_id = $2
      ORDER BY s.created_at DESC`,
    [rideId, userId],
  );
  const r = p.ride;
  const showDriver =
    p.role === "passenger" &&
    r.driver_profile_id !== null &&
    r.driver_name !== null;
  const canShare =
    p.role === "passenger" && SHAREABLE_STATUSES.includes(r.status);
  return {
    rideId,
    role: p.role,
    currentParticipant: p.current,
    status: r.status,
    driver: showDriver
      ? {
          name: r.driver_name!,
          vehicle: `${r.vehicle_make} ${r.vehicle_model}`,
          plate: r.vehicle_plate ?? "",
        }
      : null,
    passengerName:
      p.role === "driver" && p.current
        ? (r.passenger_name ?? "Passenger")
        : null,
    canReport,
    reportBy: iso(reportBy),
    reports: rows.map(myReport),
    canShare,
    shares:
      p.role === "passenger" ? await listShares(deps.db, rideId, now) : [],
  };
}

const SAFETY_ADMIN_SQL = `
  SELECT s.*, o.display_name AS assigned_name,
         (SELECT count(*)::int FROM mobility.safety_report_messages m
           WHERE m.report_id = s.id) AS message_count
    FROM mobility.safety_reports s
    LEFT JOIN mobility.operators o ON o.id = s.assigned_operator_id`;

type AdminReportRow = ReportRow & { assigned_name: string | null };

export const adminSafetyItem = (
  s: AdminReportRow,
  operator: OperatorRow,
): AdminSafetyItem => ({
  id: s.id,
  rideId: s.ride_id,
  category: s.category,
  status: s.status,
  reporterRole: s.reporter_role,
  assignedTo: s.assigned_name,
  assignedToMe: s.assigned_operator_id === operator.id,
  version: s.version,
  reportedMessages: Number(s.message_count ?? 0),
  createdAt: iso(s.created_at)!,
  updatedAt: iso(s.updated_at)!,
});

export async function listSafetyReports(
  db: SqlClient,
  operator: OperatorRow,
  q: {
    status: SafetyReportStatus | "all";
    category?: SafetyCategory;
    rideId?: string;
    from?: string;
    to?: string;
    cursor: [string, string] | null;
    limit: number;
  },
) {
  const { rows } = await db.query<AdminReportRow>(
    `${SAFETY_ADMIN_SQL}
      WHERE ($1::text = 'all' OR s.status = $1::text)
        AND ($2::text IS NULL OR s.category = $2::text)
        AND ($3::uuid IS NULL OR s.ride_id = $3::uuid)
        AND ($4::timestamptz IS NULL OR s.created_at >= $4::timestamptz)
        AND ($5::timestamptz IS NULL OR s.created_at < $5::timestamptz)
        AND ($6::timestamptz IS NULL OR (s.created_at, s.id) < ($6::timestamptz, $7::uuid))
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT $8`,
    [
      q.status,
      q.category ?? null,
      q.rideId ?? null,
      q.from ?? null,
      q.to ?? null,
      q.cursor?.[0] ?? null,
      q.cursor?.[1] ?? null,
      q.limit + 1,
    ],
  );
  return rows.map((r) => ({ row: r, item: adminSafetyItem(r, operator) }));
}

export async function safetyDetail(
  db: SqlClient,
  reportId: string,
  operator: OperatorRow,
): Promise<AdminSafetyDetail> {
  const { rows } = await db.query<
    AdminReportRow & { reporter_name: string | null; reporter_clerk_id: string }
  >(
    `SELECT x.*, u.name AS reporter_name, u.clerk_id AS reporter_clerk_id
       FROM (${SAFETY_ADMIN_SQL} WHERE s.id = $1) x
       JOIN mobility.users u ON u.id = x.reporter_user_id`,
    [reportId],
  );
  const s = rows[0];
  if (!s) throw notFound("Safety report");
  const [ride, events, messages, history] = await Promise.all([
    db.query<{
      status: RideStatus;
      created_at: Date;
      completed_at: Date | null;
      interrupted_at: Date | null;
      cancelled_at: Date | null;
      rematch_count: number;
      passenger_name: string | null;
      passenger_clerk_id: string;
      driver_name: string | null;
      vehicle_make: string | null;
      vehicle_model: string | null;
      vehicle_plate: string | null;
    }>(
      `SELECT r.status, r.created_at, r.completed_at, r.interrupted_at, r.cancelled_at,
              r.rematch_count, COALESCE(r.passenger_name, u.name) AS passenger_name, u.clerk_id AS passenger_clerk_id,
              dp.display_name AS driver_name, dp.vehicle_make, dp.vehicle_model, dp.vehicle_plate
         FROM mobility.rides r
         JOIN mobility.users u ON u.id = r.user_id
         LEFT JOIN mobility.driver_profiles dp ON dp.id = r.driver_profile_id
        WHERE r.id = $1`,
      [s.ride_id],
    ),
    db.query<{
      from_status: string;
      to_status: string;
      actor: string;
      reason: string | null;
      created_at: Date;
    }>(
      `SELECT from_status, to_status, actor, reason, created_at
         FROM mobility.ride_events WHERE ride_id = $1 ORDER BY id`,
      [s.ride_id],
    ),
    db.query<{
      message_id: string;
      message_seq: number;
      sender_role: "passenger" | "driver";
      snapshot_body: string | null;
      message_created_at: Date;
      redacted_at: Date | null;
    }>(
      `SELECT message_id, message_seq, sender_role, snapshot_body, message_created_at, redacted_at
         FROM mobility.safety_report_messages WHERE report_id = $1 ORDER BY message_seq`,
      [reportId],
    ),
    db.query<{
      action: string;
      actor: string;
      operator: string | null;
      from_status: string | null;
      to_status: string | null;
      note: string | null;
      created_at: Date;
    }>(
      `SELECT e.action, e.actor, o.display_name AS operator, e.from_status, e.to_status,
              e.note, e.created_at
         FROM mobility.safety_report_events e
         LEFT JOIN mobility.operators o ON o.id = e.operator_id
        WHERE e.report_id = $1 ORDER BY e.id`,
      [reportId],
    ),
  ]);
  const r = ride.rows[0];
  return {
    ...adminSafetyItem(s, operator),
    description: s.description,
    reporter: {
      name: s.reporter_name,
      account: maskAccount(s.reporter_clerk_id),
    },
    resolutionNote: s.resolution_note,
    evidenceRetainedUntil: iso(s.evidence_retained_until),
    closedAt: iso(s.closed_at),
    ride: {
      status: r.status,
      createdAt: iso(r.created_at)!,
      completedAt: iso(r.completed_at),
      endedAt: iso(r.completed_at ?? r.interrupted_at ?? r.cancelled_at),
      passenger: {
        name: r.passenger_name,
        account: maskAccount(r.passenger_clerk_id),
      },
      driver: r.driver_name
        ? {
            name: r.driver_name,
            vehicle: `${r.vehicle_make} ${r.vehicle_model}`,
            plate: r.vehicle_plate ?? "",
          }
        : null,
      rematchCount: r.rematch_count,
    },
    rideEvents: events.rows.map((e) => ({
      fromStatus: e.from_status,
      toStatus: e.to_status,
      actor: e.actor,
      reason: e.reason,
      createdAt: iso(e.created_at)!,
    })),
    messages: messages.rows.map((m) => ({
      messageId: m.message_id,
      seq: m.message_seq,
      senderRole: m.sender_role,
      body: m.snapshot_body,
      sentAt: iso(m.message_created_at)!,
      redacted: m.redacted_at !== null,
    })),
    history: history.rows.map((h) => ({
      action: h.action,
      actor: h.actor,
      operator: h.operator,
      fromStatus: h.from_status,
      toStatus: h.to_status,
      note: h.note,
      createdAt: iso(h.created_at)!,
    })),
  };
}

type TriageAction =
  "assign" | "in_review" | "resolve" | "dismiss" | "reopen" | "note";

export async function triageSafetyReport(
  deps: { db: Database; now: () => Date },
  reportId: string,
  operator: OperatorRow,
  input: { action: TriageAction; note?: string; expectedVersion: number },
) {
  const now = deps.now();
  const retainUntil = new Date(
    now.getTime() + SAFETY_RULES.evidenceRetentionDays * DAY_MS,
  );
  const result = await transaction(deps.db, async (tx) => {
    const { rows: current } = await tx.query<ReportRow>(
      "SELECT * FROM mobility.safety_reports WHERE id = $1 FOR UPDATE",
      [reportId],
    );
    const before = current[0];
    if (!before) throw notFound("Safety report");
    const closed =
      before.status === "resolved" || before.status === "dismissed";
    const mine = before.assigned_operator_id === operator.id;
    const fail = (code: string, message: string) => ({
      ok: false as const,
      code,
      message,
      before,
    });
    if (before.version !== input.expectedVersion) {
      return fail(
        "VERSION_CONFLICT",
        "This report changed since you opened it. Reload and try again.",
      );
    }
    let next: SafetyReportStatus = before.status;
    let set = "";
    const values: unknown[] = [];
    switch (input.action) {
      case "assign":
        if (closed)
          return fail(
            "INVALID_TRANSITION",
            "Reopen the report before assigning it.",
          );
        if (before.assigned_operator_id && !mine) {
          return fail(
            "ASSIGNED_TO_OTHER",
            "Another operator is handling this report.",
          );
        }
        next = before.status === "open" ? "in_review" : before.status;
        set = "assigned_operator_id = $4";
        values.push(operator.id);
        break;
      case "in_review":
        if (before.status !== "open") {
          return fail(
            "INVALID_TRANSITION",
            "Only open reports can be moved to review.",
          );
        }
        next = "in_review";
        break;
      case "resolve":
      case "dismiss":
        if (closed)
          return fail("INVALID_TRANSITION", "This report is already closed.");
        if (!mine)
          return fail(
            "NOT_ASSIGNED_TO_YOU",
            "Assign the report to yourself first.",
          );
        next = input.action === "resolve" ? "resolved" : "dismissed";
        set =
          "closed_at = $4, resolution_note = $5, evidence_retained_until = $6";
        values.push(now, input.note, retainUntil);
        break;
      case "reopen":
        if (!closed)
          return fail(
            "INVALID_TRANSITION",
            "Only closed reports can be reopened.",
          );
        next = "open";
        set =
          "closed_at = NULL, evidence_retained_until = NULL, assigned_operator_id = NULL";
        break;
      case "note":
        break;
    }
    const { rows } = await tx.query<ReportRow>(
      `UPDATE mobility.safety_reports
          SET status = $2, version = version + 1, updated_at = $3${set ? `, ${set}` : ""}
        WHERE id = $1 RETURNING *`,
      [reportId, next, now, ...values],
    );
    await tx.query(
      `INSERT INTO mobility.safety_report_events
         (report_id, actor, operator_id, action, from_status, to_status, note, created_at)
       VALUES ($1, 'operator', $2, $3, $4, $5, $6, $7)`,
      [
        reportId,
        operator.id,
        input.action === "assign"
          ? "assigned"
          : input.action === "note"
            ? "note_added"
            : "status_changed",
        before.status,
        next,
        input.note ?? null,
        now,
      ],
    );
    if (next !== before.status) {
      await enqueueNotification(
        tx,
        {
          userId: before.reporter_user_id,
          rideId: before.ride_id,
          kind: "safety_update",
          dedupeKey: `safety:${reportId}:${rows[0].version}`,
          ...NOTIFY.safety(next),
          target: `/safety/${before.ride_id}`,
        },
        now,
      );
    }
    return { ok: true as const, before, after: rows[0] };
  });
  await audit(deps.db, {
    operator,
    action: `safety_${input.action}`,
    targetType: "safety_report",
    targetId: reportId,
    reason: input.note ?? null,
    result: result.ok ? "succeeded" : "failed",
    detail: result.ok
      ? { fromStatus: result.before.status, toStatus: result.after.status }
      : { error: result.code, currentStatus: result.before.status },
  });
  if (!result.ok) throw new ApiError(409, result.code, result.message);
  return result.after;
}

export async function redactExpiredEvidence(
  deps: { db: Database; now: () => Date },
  limit = 200,
) {
  const now = deps.now();
  const { rows } = await deps.db.query<{ report_id: string }>(
    `UPDATE mobility.safety_report_messages m
        SET snapshot_body = NULL, redacted_at = $1
      WHERE m.id IN (
        SELECT m2.id FROM mobility.safety_report_messages m2
          JOIN mobility.safety_reports s ON s.id = m2.report_id
         WHERE m2.redacted_at IS NULL
           AND s.status IN ('resolved', 'dismissed')
           AND s.evidence_retained_until < $1
         LIMIT $2)
      RETURNING m.report_id`,
    [now, limit],
  );
  for (const reportId of new Set(rows.map((r) => r.report_id))) {
    await deps.db.query(
      `INSERT INTO mobility.safety_report_events (report_id, actor, action, note, created_at)
       VALUES ($1, 'system', 'evidence_redacted', $2, $3)`,
      [
        reportId,
        `Chat evidence removed after the ${SAFETY_RULES.evidenceRetentionDays}-day retention period.`,
        now,
      ],
    );
  }
  return rows.length;
}
