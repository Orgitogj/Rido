import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "db", "migrations");

export async function migrate(client, log = () => {}) {
  await client.query(`CREATE TABLE IF NOT EXISTS public.mobility_schema_migrations (
    name varchar(200) PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await client.query(
    "SELECT name FROM public.mobility_schema_migrations",
  );
  const applied = new Set(rows.map((row) => row.name));
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO public.mobility_schema_migrations (name) VALUES ($1)",
        [file],
      );
      await client.query("COMMIT");
      log(`applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${error.message}`);
    }
  }
}

export async function seed(client) {
  await client.query(await readFile(path.join(root, "db", "seed.sql"), "utf8"));
}

export function loadEnv() {
  try {
    process.loadEnvFile(path.join(root, ".env"));
  } catch {}
}
