import { paymentMode } from "./paymentMode";

export type ConfigLevel = "required" | "recommended" | "optional";

export interface ConfigCheck {
  area: string;
  name: string;
  level: ConfigLevel;
  ok: boolean;
  note: string;
}

type Env = Record<string, string | undefined>;

const has = (env: Env, name: string) => Boolean(env[name]?.trim());

export function environmentOf(env: Env = process.env) {
  return env.NODE_ENV === "production" ? "production" : "development";
}

export function stripeModeOf(env: Env = process.env) {
  const key = env.STRIPE_SECRET_KEY?.trim() ?? "";
  return key.startsWith("sk_test_")
    ? "test"
    : key.startsWith("sk_live_")
      ? "live"
      : "unconfigured";
}

export function checkConfig(env: Env = process.env): ConfigCheck[] {
  const production = environmentOf(env) === "production";
  const serverUrl = env.EXPO_PUBLIC_SERVER_URL?.trim() ?? "";
  const storageParts = [
    "DOCUMENT_STORAGE_BUCKET",
    "DOCUMENT_STORAGE_ACCESS_KEY_ID",
    "DOCUMENT_STORAGE_SECRET_ACCESS_KEY",
  ].filter((n) => has(env, n)).length;
  const stripeMode = stripeModeOf(env);
  const cardOnline = paymentMode(env) === "card_online";
  const all: ConfigCheck[] = [
    {
      area: "Database",
      name: "DATABASE_URL",
      level: "required",
      ok: has(env, "DATABASE_URL"),
      note: "PostgreSQL connection for all data.",
    },
    {
      area: "Clerk",
      name: "CLERK_SECRET_KEY or CLERK_JWT_KEY",
      level: "required",
      ok: has(env, "CLERK_SECRET_KEY") || has(env, "CLERK_JWT_KEY"),
      note: "Verifies every session token.",
    },
    {
      area: "Clerk",
      name: "CLERK_SECRET_KEY",
      level: "recommended",
      ok: has(env, "CLERK_SECRET_KEY"),
      note: "Needed to delete the sign-in identity when an account is deleted. Without it deletions stay pending.",
    },
    {
      area: "Clerk",
      name: "CLERK_AUTHORIZED_PARTIES",
      level: production ? "required" : "recommended",
      ok: has(env, "CLERK_AUTHORIZED_PARTIES"),
      note: "Restricts which origins' tokens are accepted.",
    },
    {
      area: "Payments",
      name: "PAYMENT_MODE",
      level: "optional",
      ok: true,
      note: cardOnline
        ? "card_online: cards are authorized in the app through Stripe."
        : "in_vehicle (default): passengers pay the driver by card terminal or cash; Stripe is not used.",
    },
    {
      area: "Stripe",
      name: "STRIPE_SECRET_KEY",
      level: cardOnline ? "required" : "optional",
      ok: stripeMode !== "unconfigured",
      note:
        stripeMode === "live"
          ? "Live key: real money moves. Console refunds stay disabled."
          : stripeMode === "test"
            ? "Test mode."
            : "Not set or not a Stripe secret key.",
    },
    {
      area: "Stripe",
      name: "STRIPE_WEBHOOK_SECRET",
      level: !cardOnline ? "optional" : production ? "required" : "recommended",
      ok: has(env, "STRIPE_WEBHOOK_SECRET"),
      note: "Verifies payment, refund and dispute webhooks. Without it only the sweep recovers payment state.",
    },
    {
      area: "Scheduler",
      name: "CRON_SECRET",
      level: "required",
      ok: (env.CRON_SECRET?.trim().length ?? 0) >= 16,
      note: "At least 16 characters. Protects POST /api/internal/sweep.",
    },
    {
      area: "Google Routes",
      name: "GOOGLE_ROUTES_API_KEY",
      level: "required",
      ok: has(env, "GOOGLE_ROUTES_API_KEY"),
      note: "Needed for every quote. Without it quotes are refused, not guessed.",
    },
    {
      area: "Document storage",
      name: "DOCUMENT_STORAGE_BUCKET, _ACCESS_KEY_ID, _SECRET_ACCESS_KEY",
      level: "recommended",
      ok: storageParts === 3,
      note:
        storageParts === 0
          ? "Not set: driver document uploads answer 503."
          : storageParts === 3
            ? "Configured. Verify the bucket is private."
            : "Partly set: all three are needed.",
    },
    {
      area: "Push",
      name: "PUSH_NOTIFICATIONS",
      level: "optional",
      ok: env.PUSH_NOTIFICATIONS !== "off",
      note:
        env.PUSH_NOTIFICATIONS === "off"
          ? "Push delivery is switched off. The in-app inbox still works."
          : "Expo push delivery is on.",
    },
    {
      area: "Public URL",
      name: "EXPO_PUBLIC_SERVER_URL",
      level: production ? "required" : "recommended",
      ok: production ? serverUrl.startsWith("https://") : true,
      note: production
        ? "Must be the https URL app builds use."
        : "Optional in development; Expo uses the dev server.",
    },
  ];
  return all;
}

export function configReady(env: Env = process.env) {
  return checkConfig(env).every((c) => c.level !== "required" || c.ok);
}
