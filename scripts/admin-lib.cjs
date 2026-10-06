const ASSIGNED = ["accepted", "arriving", "arrived", "in_progress"];

async function findDriver(client, ref) {
  const { rows } = await client.query(
    `SELECT dp.*, u.clerk_id FROM mobility.driver_profiles dp
       JOIN mobility.users u ON u.id = dp.user_id
      WHERE dp.id::text = $1 OR u.clerk_id = $1 OR upper(dp.vehicle_plate) = upper($1)`,
    [ref],
  );
  if (rows.length !== 1) {
    throw new Error(
      rows.length
        ? `"${ref}" matches ${rows.length} drivers; use the profile id.`
        : `No driver matches "${ref}".`,
    );
  }
  return rows[0];
}

async function listDrivers(client) {
  const { rows } = await client.query(
    `SELECT dp.id, u.clerk_id, dp.display_name, dp.vehicle_make, dp.vehicle_model,
            dp.vehicle_plate, dp.status, dp.online, dp.last_seen_at
       FROM mobility.driver_profiles dp JOIN mobility.users u ON u.id = dp.user_id
      ORDER BY dp.created_at`,
  );
  return rows;
}

async function setDriverStatus(client, ref, status, opts = {}) {
  if (!["approved", "suspended"].includes(status))
    throw new Error("Invalid status");
  const reason = String(opts.reason || "").trim();
  if (reason.length < 3)
    throw new Error('A reason is required (--reason "...").');
  if (status === "approved" && !opts.waiveDocuments)
    throw new Error(
      "The CLI can only approve with --waive-documents, as a development or recovery override. Review applications in the operations console.",
    );
  const driver = await findDriver(client, ref);
  let categoryIds = [];
  if (status === "approved") {
    const codes = Array.isArray(opts.categories)
      ? opts.categories
      : String(opts.categories || "")
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean);
    if (!codes.length)
      throw new Error(
        'Name the vehicle categories this vehicle may serve (--categories general). Run "categories" to list them.',
      );
    const found = await client.query(
      "SELECT id, code FROM mobility.vehicle_categories WHERE code = ANY($1::text[])",
      [codes],
    );
    const missing = codes.filter((c) => !found.rows.some((r) => r.code === c));
    if (missing.length)
      throw new Error(`Unknown vehicle category: ${missing.join(", ")}.`);
    categoryIds = found.rows.map((r) => r.id);
  }
  if (status === "suspended") {
    const busy = await client.query(
      "SELECT 1 FROM mobility.rides WHERE driver_profile_id = $1 AND status = ANY($2::text[])",
      [driver.id, ASSIGNED],
    );
    if (busy.rows.length)
      throw new Error(
        "Driver has an active ride. Suspend from the operations console, which re-matches or flags the ride.",
      );
  }
  const { rows } = await client.query(
    status === "approved"
      ? `UPDATE mobility.driver_profiles
            SET status = 'approved', documents_waived = true,
                waiver_note = left('CLI override: ' || $2, 200),
                approved_at = now(), approved_by = NULL, approval_expires_at = NULL,
                applicant_message = NULL, review_version = review_version + 1, updated_at = now()
          WHERE id = $1 RETURNING id, display_name, status`
      : `UPDATE mobility.driver_profiles
            SET status = 'suspended', online = false,
                review_version = review_version + 1, updated_at = now()
          WHERE id = $1 RETURNING id, display_name, status`,
    status === "approved" ? [driver.id, reason] : [driver.id],
  );
  if (status === "approved") {
    await client.query(
      `DELETE FROM mobility.driver_vehicle_categories
        WHERE driver_profile_id = $1 AND NOT (vehicle_category_id = ANY($2::uuid[]))`,
      [driver.id, categoryIds],
    );
    for (const id of categoryIds) {
      await client.query(
        `INSERT INTO mobility.driver_vehicle_categories
           (driver_profile_id, vehicle_category_id, source, created_at)
         VALUES ($1, $2, 'cli', now())
         ON CONFLICT (driver_profile_id, vehicle_category_id) DO NOTHING`,
        [driver.id, id],
      );
    }
  }
  await client.query(
    `INSERT INTO mobility.driver_review_events
       (driver_profile_id, actor, action, from_status, to_status, reason, created_at)
     VALUES ($1, 'cli', $2, $3, $4, $5, now())`,
    [
      driver.id,
      status === "approved" ? "approved_with_waiver" : "suspended",
      driver.status,
      status,
      reason.slice(0, 1000),
    ],
  );
  return rows[0];
}

async function listCategories(client) {
  const { rows } = await client.query(
    "SELECT code, name, capacity, status, is_default FROM mobility.vehicle_categories ORDER BY is_default DESC, code",
  );
  return rows;
}

module.exports = { findDriver, listDrivers, setDriverStatus, listCategories };

const PERMISSIONS = ["view", "support", "refund", "verify", "configure"];

async function cliAudit(
  client,
  actor,
  action,
  targetType,
  targetId,
  reason,
  detail,
) {
  await client.query(
    `INSERT INTO mobility.audit_log (operator_id, actor, action, target_type, target_id, reason, result, detail)
     VALUES (NULL, $1, $2, $3, $4, $5, 'succeeded', $6::jsonb)`,
    [
      `cli:${actor}`.slice(0, 120),
      action,
      targetType,
      targetId,
      reason,
      JSON.stringify(detail || {}),
    ],
  );
}

function parsePermissions(input) {
  const list = String(input || "view")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  for (const p of list) {
    if (!PERMISSIONS.includes(p))
      throw new Error(
        `Unknown permission "${p}". Use view, support, refund, verify, configure.`,
      );
  }
  return {
    can_view: true,
    can_support: list.includes("support"),
    can_refund: list.includes("refund"),
    can_verify: list.includes("verify"),
    can_configure: list.includes("configure"),
  };
}

async function grantOperator(
  client,
  { clerkId, displayName, permissions, grantedBy },
) {
  if (!/^user_[A-Za-z0-9_]+$/.test(String(clerkId)))
    throw new Error("Pass the operator's Clerk user id (user_...).");
  if (!displayName || String(displayName).trim().length < 2)
    throw new Error("A display name is required.");
  if (!grantedBy)
    throw new Error("The granting user is required for the audit trail.");
  const perms = parsePermissions(permissions);
  const { rows: users } = await client.query(
    "SELECT id FROM mobility.users WHERE clerk_id = $1",
    [clerkId],
  );
  if (!users[0])
    throw new Error(
      "No account with that Clerk id. Ask them to sign in to the app once first.",
    );
  const { rows } = await client.query(
    `INSERT INTO mobility.operators (user_id, display_name, can_view, can_support, can_refund, can_verify, can_configure, granted_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET
       display_name = EXCLUDED.display_name, can_view = EXCLUDED.can_view,
       can_support = EXCLUDED.can_support, can_refund = EXCLUDED.can_refund,
       can_verify = EXCLUDED.can_verify, can_configure = EXCLUDED.can_configure,
       granted_by = EXCLUDED.granted_by, active = true, revoked_at = NULL, updated_at = now()
     RETURNING id, display_name, can_view, can_support, can_refund, can_verify, can_configure`,
    [
      users[0].id,
      String(displayName).trim().slice(0, 100),
      perms.can_view,
      perms.can_support,
      perms.can_refund,
      perms.can_verify,
      perms.can_configure,
      String(grantedBy).slice(0, 100),
    ],
  );
  await cliAudit(
    client,
    grantedBy,
    "operator_grant",
    "operator",
    rows[0].id,
    null,
    {
      permissions: PERMISSIONS.filter((p) => rows[0][`can_${p}`]),
    },
  );
  return rows[0];
}

async function revokeOperator(client, { clerkId, grantedBy, reason }) {
  if (!grantedBy)
    throw new Error("The revoking user is required for the audit trail.");
  const { rows } = await client.query(
    `UPDATE mobility.operators o SET active = false, revoked_at = now(), updated_at = now()
       FROM mobility.users u
      WHERE u.id = o.user_id AND u.clerk_id = $1 AND o.active
      RETURNING o.id, o.display_name`,
    [clerkId],
  );
  if (!rows[0]) throw new Error("No active operator with that Clerk id.");
  await client.query(
    "UPDATE mobility.support_requests SET assigned_operator_id = NULL, status = CASE WHEN status = 'in_progress' THEN 'open' ELSE status END, version = version + 1, updated_at = now() WHERE assigned_operator_id = $1 AND status <> 'resolved'",
    [rows[0].id],
  );
  await cliAudit(
    client,
    grantedBy,
    "operator_revoke",
    "operator",
    rows[0].id,
    reason || null,
    {},
  );
  return rows[0];
}

async function listOperators(client) {
  const { rows } = await client.query(
    `SELECT o.id, u.clerk_id, o.display_name, o.can_view, o.can_support, o.can_refund,
            o.can_verify, o.can_configure, o.active, o.granted_by, o.created_at, o.revoked_at
       FROM mobility.operators o JOIN mobility.users u ON u.id = o.user_id
      ORDER BY o.created_at`,
  );
  return rows;
}

async function auditDriverStatus(client, actor, driverId, status, reason) {
  await cliAudit(
    client,
    actor,
    `driver_${status}`,
    "driver_profile",
    driverId,
    reason || null,
    status === "approved" ? { documentsWaived: true } : {},
  );
}

module.exports.grantOperator = grantOperator;
module.exports.revokeOperator = revokeOperator;
module.exports.listOperators = listOperators;
module.exports.auditDriverStatus = auditDriverStatus;
module.exports.PERMISSIONS = PERMISSIONS;
