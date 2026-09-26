export default async function teardown() {
  const handle = globalThis.__PGLITE__;
  if (!handle) return;
  await handle.server.stop();
  await handle.db.close();
}
