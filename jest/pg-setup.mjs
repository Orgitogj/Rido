import net from "node:net";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";

import { migrate, seed } from "../scripts/db-lib.mjs";

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function prepare(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await migrate(client);
  await migrate(client);
  await seed(client);
  await seed(client);
  await client.end();
}

async function prepareExternalDatabase(url) {
  if (process.env.TEST_DATABASE_ALLOW_RESET !== "1") {
    throw new Error(
      "TEST_DATABASE_URL is set but TEST_DATABASE_ALLOW_RESET=1 is not. Refusing to reset that database.",
    );
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS mobility CASCADE");
  await client.query("DROP TABLE IF EXISTS public.mobility_schema_migrations");
  await client.end();
  await prepare(url);
}

export default async function setup() {
  if (process.env.TEST_DATABASE_URL) {
    await prepareExternalDatabase(process.env.TEST_DATABASE_URL);
    return;
  }
  const db = await PGlite.create();
  const port = await freePort();
  const server = new PGLiteSocketServer({
    db,
    port,
    host: "127.0.0.1",
    maxConnections: 16,
  });
  await server.start();
  globalThis.__PGLITE__ = { db, server };

  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
  process.env.TEST_DATABASE_URL = url;

  await prepare(url);
}
