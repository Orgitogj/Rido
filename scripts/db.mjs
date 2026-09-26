import pg from "pg";

import { loadEnv, migrate, seed } from "./db-lib.mjs";

const command = process.argv[2];
if (!["migrate", "seed", "setup"].includes(command)) {
  console.error("Usage: node scripts/db.mjs <migrate|seed|setup>");
  process.exit(2);
}

loadEnv();
if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill it in.",
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  if (command !== "seed") await migrate(client, (msg) => console.log(msg));
  if (command !== "migrate") {
    await seed(client);
    console.log("seeded demo drivers");
  }
  console.log("done");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
