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
    `INSERT INTO mobility.users (clerk_id) VALUES ($1)
     ON CONFLICT (clerk_id) DO UPDATE SET clerk_id = EXCLUDED.clerk_id
     RETURNING id, clerk_id, name, stripe_customer_id`,
    [identity.clerkId],
  );
  return rows[0];
}
