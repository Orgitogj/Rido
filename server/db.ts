import { Pool } from "pg";

import { requireEnv } from "./errors";

export interface SqlClient {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface Database extends SqlClient {
  connect(): Promise<SqlClient & { release(): void }>;
}

let pool: Pool | undefined;

export function database(): Database {
  pool ??= new Pool({
    connectionString: requireEnv("DATABASE_URL"),
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
  });
  return pool;
}

export async function transaction<T>(
  db: Database,
  fn: (tx: SqlClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
