import { createHash } from "node:crypto";

import { ApiError } from "./errors";

import type { Identity } from "./auth";
import type { SqlClient } from "./db";

export interface AppUser {
  id: string;
  clerk_id: string;
  name: string | null;
  stripe_customer_id: string | null;
}

export async function ensureUser(
  db: SqlClient,
  identity: Identity,
): Promise<AppUser> {
  const { rows } = await db.query<AppUser>(
    `INSERT INTO mobility.users (clerk_id)
     SELECT $1
      WHERE NOT EXISTS (
        SELECT 1 FROM mobility.account_deletions WHERE clerk_id_hash = $2)
     ON CONFLICT (clerk_id) DO UPDATE SET clerk_id = EXCLUDED.clerk_id
     RETURNING id, clerk_id, name, stripe_customer_id`,
    [
      identity.clerkId,
      createHash("sha256").update(identity.clerkId).digest("hex"),
    ],
  );
  if (!rows[0]) {
    throw new ApiError(
      403,
      "ACCOUNT_DELETED",
      "This account has been deleted and can't be used.",
    );
  }
  return rows[0];
}
