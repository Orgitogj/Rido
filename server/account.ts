import { createHash } from "node:crypto";

import { type Database, type SqlClient, transaction } from "./db";
import { ApiError } from "./errors";
import { ACTIVE_STATUSES, ASSIGNED_STATUSES } from "./lifecycle";
import { clearDriverLocation } from "./location";

import type { PaymentGateway } from "./payments";
import type {
  AccountDeletionResult,
  DeletionBlocker,
  DeletionStatus,
} from "../shared/account";

export interface IdentityAdmin {
  deleteUser(clerkId: string): Promise<void>;
}

export const ACCOUNT_DELETION = {
  reauthMaxMinutes: 10,
  retryBaseSeconds: 60,
  retryMaxSeconds: 6 * 3600,
} as const;

export const clerkIdHash = (clerkId: string) =>
  createHash("sha256").update(clerkId).digest("hex");

export function clerkIdentityAdmin(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): IdentityAdmin | null {
  const secretKey = env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) return null;
  return {
    async deleteUser(clerkId) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetchImpl(
          `https://api.clerk.com/v1/users/${encodeURIComponent(clerkId)}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${secretKey}` },
            signal: controller.signal,
          },
        );
        if (!res.ok && res.status !== 404) {
          throw new Error(`Clerk user deletion failed (${res.status})`);
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

async function blockersFor(
  db: SqlClient,
  userId: string,
): Promise<DeletionBlocker[]> {
  const blockers: DeletionBlocker[] = [];
  const has = async (sql: string, values: unknown[]) =>
    (await db.query(sql, values)).rows.length > 0;
  if (
    await has(
      "SELECT 1 FROM mobility.rides WHERE user_id = $1 AND status = ANY($2::text[]) LIMIT 1",
      [userId, ACTIVE_STATUSES],
    )
  ) {
    blockers.push("ACTIVE_RIDE");
  }
  if (
    await has(
      `SELECT 1 FROM mobility.rides r JOIN mobility.driver_profiles dp ON dp.id = r.driver_profile_id
        WHERE dp.user_id = $1 AND r.status = ANY($2::text[]) LIMIT 1`,
      [userId, ASSIGNED_STATUSES],
    )
  ) {
    blockers.push("ACTIVE_DRIVER_RIDE");
  }
  if (
    await has(
      "SELECT 1 FROM mobility.driver_profiles WHERE user_id = $1 AND online",
      [userId],
    )
  ) {
    blockers.push("DRIVER_ONLINE");
  }
  if (
    await has(
      `SELECT 1 FROM mobility.rides
        WHERE user_id = $1 AND stripe_payment_intent_id IS NOT NULL AND settled_at IS NULL
          AND ((status = 'completed' AND payment_status = 'authorized')
            OR (status IN ('cancelled', 'no_driver', 'interrupted')
                AND payment_status NOT IN ('cancelled', 'paid', 'expired', 'pending', 'failed')))
        LIMIT 1`,
      [userId],
    )
  ) {
    blockers.push("PAYMENT_IN_PROGRESS");
  } else if (
    await has(
      `SELECT 1 FROM mobility.tips
        WHERE user_id = $1 AND status IN ('creating', 'pending', 'requires_action', 'processing')
        LIMIT 1`,
      [userId],
    )
  ) {
    blockers.push("PAYMENT_IN_PROGRESS");
  }
  if (
    await has(
      "SELECT 1 FROM mobility.operators WHERE user_id = $1 AND active",
      [userId],
    )
  ) {
    blockers.push("OPERATOR_ACCOUNT");
  }
  return blockers;
}

export async function deletionStatus(
  db: SqlClient,
  userId: string,
  factorAgeMinutes: number | null,
): Promise<DeletionStatus> {
  const blockers = await blockersFor(db, userId);
  return {
    blockers,
    reauthRequired:
      factorAgeMinutes === null ||
      factorAgeMinutes > ACCOUNT_DELETION.reauthMaxMinutes,
  };
}

async function anonymize(tx: SqlClient, userId: string, now: Date) {
  await tx.query("DELETE FROM mobility.saved_places WHERE user_id = $1", [
    userId,
  ]);
  await tx.query(
    "DELETE FROM mobility.notification_preferences WHERE user_id = $1",
    [userId],
  );
  await tx.query("DELETE FROM mobility.push_tokens WHERE user_id = $1", [
    userId,
  ]);
  await tx.query(
    `DELETE FROM mobility.push_tickets
      WHERE notification_id IN (SELECT id FROM mobility.notifications WHERE user_id = $1)`,
    [userId],
  );
  await tx.query("DELETE FROM mobility.notifications WHERE user_id = $1", [
    userId,
  ]);
  await tx.query(
    "DELETE FROM mobility.ride_messages WHERE sender_user_id = $1",
    [userId],
  );
  await tx.query(
    "UPDATE mobility.ratings SET comment = NULL WHERE rater_user_id = $1",
    [userId],
  );
  await tx.query(
    `UPDATE mobility.support_attachments SET delete_after = $2
      WHERE user_id = $1 AND status <> 'deleted'`,
    [userId, now],
  );
  await tx.query(
    `UPDATE mobility.trip_shares SET revoked_at = $2
      WHERE created_by = $1 AND revoked_at IS NULL`,
    [userId, now],
  );
  await tx.query(
    `DELETE FROM mobility.quotes q
      WHERE q.user_id = $1
        AND NOT EXISTS (SELECT 1 FROM mobility.rides r WHERE r.quote_id = q.id)`,
    [userId],
  );
  await tx.query(
    "UPDATE mobility.rides SET passenger_name = NULL WHERE user_id = $1",
    [userId],
  );

  const { rows: profiles } = await tx.query<{ id: string; status: string }>(
    "SELECT id, status FROM mobility.driver_profiles WHERE user_id = $1 FOR UPDATE",
    [userId],
  );
  const profile = profiles[0];
  if (profile) {
    await tx.query(
      `UPDATE mobility.ride_offers SET status = 'withdrawn', responded_at = $2
        WHERE driver_profile_id = $1 AND status = 'pending'`,
      [profile.id, now],
    );
    await tx.query(
      `UPDATE mobility.driver_documents SET delete_after = $2, updated_at = $2
        WHERE driver_profile_id = $1 AND status <> 'deleted'`,
      [profile.id, now],
    );
    await tx.query(
      `UPDATE mobility.driver_profiles
          SET status = 'suspended', online = false, deleted_at = $2,
              display_name = 'Deleted driver', vehicle_plate = 'DELETED',
              applicant_message = NULL, review_version = review_version + 1,
              updated_at = $2
        WHERE id = $1`,
      [profile.id, now],
    );
    await tx.query(
      `INSERT INTO mobility.driver_review_events
         (driver_profile_id, actor, action, from_status, to_status, reason, created_at)
       VALUES ($1, 'system', 'account_deleted', $2, 'suspended', 'Account deletion requested by the user', $3)`,
      [profile.id, profile.status, now],
    );
    await clearDriverLocation(tx, profile.id);
  }
}

export async function requestAccountDeletion(
  deps: {
    db: Database;
    payments: PaymentGateway;
    identity: IdentityAdmin | null;
    now: () => Date;
  },
  user: { id: string; clerk_id: string },
  factorAgeMinutes: number | null,
): Promise<AccountDeletionResult> {
  if (
    factorAgeMinutes === null ||
    factorAgeMinutes > ACCOUNT_DELETION.reauthMaxMinutes
  ) {
    throw new ApiError(
      403,
      "REAUTH_REQUIRED",
      "Confirm your password again before deleting your account.",
    );
  }
  const now = deps.now();
  await transaction(deps.db, async (tx) => {
    const { rows } = await tx.query<{
      clerk_id: string;
      stripe_customer_id: string | null;
      deleted_at: Date | null;
    }>(
      "SELECT clerk_id, stripe_customer_id, deleted_at FROM mobility.users WHERE id = $1 FOR UPDATE",
      [user.id],
    );
    const row = rows[0];
    if (!row || row.deleted_at) return;
    const blockers = await blockersFor(tx, user.id);
    if (blockers.length) {
      throw new ApiError(
        409,
        "DELETION_BLOCKED",
        `Your account can't be deleted yet: ${blockers.join(", ")}.`,
      );
    }
    await tx.query(
      `INSERT INTO mobility.account_deletions
         (user_id, clerk_id_hash, clerk_id, stripe_customer_id, requested_at, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [
        user.id,
        clerkIdHash(row.clerk_id),
        row.clerk_id,
        row.stripe_customer_id,
        now,
      ],
    );
    await anonymize(tx, user.id, now);
    await tx.query(
      `UPDATE mobility.users
          SET clerk_id = 'deleted_' || id::text, name = NULL, language = NULL,
              stripe_customer_id = NULL, deleted_at = $2, updated_at = $2
        WHERE id = $1`,
      [user.id, now],
    );
  });
  await processAccountDeletions(deps, 5, user.id);
  const { rows } = await deps.db.query<{ completed_at: Date | null }>(
    "SELECT completed_at FROM mobility.account_deletions WHERE user_id = $1",
    [user.id],
  );
  return { status: rows[0]?.completed_at ? "completed" : "pending" };
}

interface DeletionJob {
  id: string;
  clerk_id: string | null;
  stripe_customer_id: string | null;
  payments_deleted_at: Date | null;
  attempts: number;
}

export async function processAccountDeletions(
  deps: {
    db: Database;
    payments: PaymentGateway;
    identity: IdentityAdmin | null;
    now: () => Date;
  },
  limit = 20,
  onlyUserId?: string,
) {
  const now = deps.now();
  const { rows } = await deps.db.query<DeletionJob>(
    `SELECT id, clerk_id, stripe_customer_id, payments_deleted_at, attempts
       FROM mobility.account_deletions
      WHERE completed_at IS NULL
        AND (($2::uuid IS NOT NULL AND user_id = $2::uuid)
          OR ($2::uuid IS NULL AND next_attempt_at <= $1))
      ORDER BY next_attempt_at LIMIT $3`,
    [now, onlyUserId ?? null, limit],
  );
  let completed = 0;
  for (const job of rows) {
    let error: string | null = null;
    let paymentsDone =
      !job.stripe_customer_id || job.payments_deleted_at !== null;
    let identityDone = job.clerk_id === null;
    if (!paymentsDone) {
      try {
        await deps.payments.deleteCustomer(job.stripe_customer_id!);
        paymentsDone = true;
      } catch (e) {
        error = `payments: ${e instanceof Error ? e.message : "failed"}`;
      }
    }
    if (!identityDone) {
      if (!deps.identity) {
        error ??= "identity: CLERK_SECRET_KEY is not configured";
      } else {
        try {
          await deps.identity.deleteUser(job.clerk_id!);
          identityDone = true;
        } catch (e) {
          error ??= `identity: ${e instanceof Error ? e.message : "failed"}`;
        }
      }
    }
    const done = paymentsDone && identityDone;
    await deps.db.query(
      `UPDATE mobility.account_deletions
          SET payments_deleted_at = CASE WHEN $2::boolean AND stripe_customer_id IS NOT NULL
                                         THEN COALESCE(payments_deleted_at, $4) ELSE payments_deleted_at END,
              identity_deleted_at = CASE WHEN $3::boolean THEN COALESCE(identity_deleted_at, $4) ELSE identity_deleted_at END,
              clerk_id = CASE WHEN $3::boolean THEN NULL ELSE clerk_id END,
              completed_at = CASE WHEN $2::boolean AND $3::boolean THEN $4 ELSE NULL END,
              attempts = attempts + 1,
              last_error = $5,
              next_attempt_at = $6
        WHERE id = $1`,
      [
        job.id,
        paymentsDone,
        identityDone,
        now,
        error ? error.slice(0, 200) : null,
        new Date(
          now.getTime() +
            Math.min(
              ACCOUNT_DELETION.retryMaxSeconds,
              ACCOUNT_DELETION.retryBaseSeconds * 2 ** job.attempts,
            ) *
              1000,
        ),
      ],
    );
    if (done) completed++;
    else {
      console.error(
        JSON.stringify({
          event: "account_deletion_step_failed",
          jobId: job.id,
        }),
      );
    }
  }
  return completed;
}
