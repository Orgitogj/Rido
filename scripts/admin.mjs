import { createRequire } from "node:module";
import { userInfo } from "node:os";

import pg from "pg";

import { loadEnv } from "./db-lib.mjs";

const {
  listDrivers,
  listCategories,
  setDriverStatus,
  grantOperator,
  revokeOperator,
  listOperators,
  auditDriverStatus,
} = createRequire(import.meta.url)("./admin-lib.cjs");

const USAGE = `Usage: npm run admin -- <command>
  drivers                                          list driver applications
  categories                                       list vehicle categories
  approve <ref> --waive-documents --categories <code,...> --reason "<text>"
                                                   development/recovery override: approve
                                                   without reviewed documents, for the named
                                                   vehicle categories (audited)
  suspend <ref> --reason "<text>"                  suspend a driver with no active ride
  operators                                        list operator accounts
  grant-operator <clerkUserId> --name "<name>" [--permissions view,support,refund,verify,configure]
  revoke-operator <clerkUserId> [--reason "<text>"]

Driver verification, support, ride review, and refunds are handled in the operations
console (/admin), where every action is tied to the operator's verified sign-in.`;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const [command, ref] = args;

if (!command || command === "help" || command === "--help") {
  console.log(USAGE);
  process.exit(command ? 0 : 2);
}

loadEnv();
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const actor = userInfo().username || "unknown";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  if (command === "drivers") {
    console.table(await listDrivers(client));
  } else if ((command === "approve" || command === "suspend") && ref) {
    const reason = flag("reason");
    const row = await setDriverStatus(
      client,
      ref,
      command === "approve" ? "approved" : "suspended",
      {
        waiveDocuments: args.includes("--waive-documents"),
        categories: flag("categories"),
        reason,
      },
    );
    await auditDriverStatus(client, actor, row.id, row.status, reason);
    console.log(
      `${row.display_name} (${row.id}) is now ${row.status}${command === "approve" ? " with documents waived. Operators will see the waiver in the console." : "."}`,
    );
  } else if (command === "categories") {
    console.table(await listCategories(client));
  } else if (command === "operators") {
    console.table(await listOperators(client));
  } else if (command === "grant-operator" && ref) {
    const row = await grantOperator(client, {
      clerkId: ref,
      displayName: flag("name"),
      permissions: flag("permissions"),
      grantedBy: actor,
    });
    console.log(
      `${row.display_name} is an operator with: ${["view", "support", "refund", "verify", "configure"].filter((p) => row[`can_${p}`]).join(", ")}.`,
    );
  } else if (command === "revoke-operator" && ref) {
    const row = await revokeOperator(client, {
      clerkId: ref,
      grantedBy: actor,
      reason: flag("reason"),
    });
    console.log(`Operator access revoked for ${row.display_name}.`);
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
