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

async function setDriverStatus(client, ref, status) {
  if (!["approved", "suspended"].includes(status))
    throw new Error("Invalid status");
  const driver = await findDriver(client, ref);
  if (status === "suspended") {
    const busy = await client.query(
      "SELECT 1 FROM mobility.rides WHERE driver_profile_id = $1 AND status = ANY($2::text[])",
      [driver.id, ASSIGNED],
    );
    if (busy.rows.length)
      throw new Error("Driver has an active ride; suspend after it ends.");
  }
  const { rows } = await client.query(
    `UPDATE mobility.driver_profiles
        SET status = $2::varchar, online = CASE WHEN $2::varchar = 'approved' THEN online ELSE false END,
            updated_at = now()
      WHERE id = $1 RETURNING id, display_name, status`,
    [driver.id, status],
  );
  return rows[0];
}

module.exports = { findDriver, listDrivers, setDriverStatus };

const PERMISSIONS = ["view", "support", "refund"];

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
      throw new Error(`Unknown permission "${p}". Use view, support, refund.`);
  }
  return {
    can_view: true,
    can_support: list.includes("support"),
    can_refund: list.includes("refund"),
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
    `INSERT INTO mobility.operators (user_id, display_name, can_view, can_support, can_refund, granted_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       display_name = EXCLUDED.display_name, can_view = EXCLUDED.can_view,
       can_support = EXCLUDED.can_support, can_refund = EXCLUDED.can_refund,
       granted_by = EXCLUDED.granted_by, active = true, revoked_at = NULL, updated_at = now()
     RETURNING id, display_name, can_view, can_support, can_refund`,
    [
      users[0].id,
      String(displayName).trim().slice(0, 100),
      perms.can_view,
      perms.can_support,
      perms.can_refund,
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
            o.active, o.granted_by, o.created_at, o.revoked_at
       FROM mobility.operators o JOIN mobility.users u ON u.id = o.user_id
      ORDER BY o.created_at`,
  );
  return rows;
}

async function auditDriverStatus(client, actor, driverId, status) {
  await cliAudit(
    client,
    actor,
    `driver_${status}`,
    "driver_profile",
    driverId,
    null,
    {},
  );
}

module.exports.grantOperator = grantOperator;
module.exports.revokeOperator = revokeOperator;
module.exports.listOperators = listOperators;
module.exports.auditDriverStatus = auditDriverStatus;
module.exports.PERMISSIONS = PERMISSIONS;
