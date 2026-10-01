import { randomUUID } from "node:crypto";

import { clerkIdentityAdmin, type IdentityAdmin } from "./account";
import { type Authenticate, clerkAuthenticator } from "./auth";
import { type Database, database } from "./db";
import { ApiError } from "./errors";
import { expoPushGateway, type PushGateway } from "./notifications";
import { type PaymentGateway, stripeGateway } from "./payments";
import { routingFromEnv, type RoutingProvider } from "./routing";
import { type DocumentStorage, storageFromEnv } from "./storage";

import type { z } from "zod";

export const MAX_BODY_BYTES = 8192;

export interface Deps {
  db: Database;
  authenticate: Authenticate;
  payments: PaymentGateway;
  routing: RoutingProvider | null;
  push: PushGateway | null;
  storage: DocumentStorage | null;
  identity: IdentityAdmin | null;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

let defaults: Deps | undefined;
export function defaultDeps(): Deps {
  defaults ??= {
    get db() {
      return database();
    },
    authenticate: clerkAuthenticator(),
    payments: stripeGateway(),
    routing: routingFromEnv(),
    push: process.env.PUSH_NOTIFICATIONS === "off" ? null : expoPushGateway(),
    storage: storageFromEnv(),
    identity: clerkIdentityAdmin(),
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
  return defaults;
}

export type Handler<P> = (
  request: Request,
  params: P,
  deps: Deps,
) => Promise<Response>;

export function route<P = Record<string, string>>(
  handler: Handler<P>,
  deps: () => Deps = defaultDeps,
) {
  return async (request: Request, params: P = {} as P): Promise<Response> => {
    const requestId = randomUUID();
    let response: Response;
    try {
      response = await handler(request, params, deps());
    } catch (error) {
      const known = error instanceof ApiError;
      const status = known ? error.status : 500;
      const code = known ? error.code : "INTERNAL_ERROR";
      if (status >= 500) {
        console.error(
          JSON.stringify({
            event: "api_failure",
            requestId,
            status,
            code,
            error: known
              ? undefined
              : error instanceof Error
                ? error.name
                : "unknown",
            dbCode: (error as { code?: unknown })?.code,
            constraint: (error as { constraint?: unknown })?.constraint,
          }),
        );
      }
      response = Response.json(
        {
          error: {
            code,
            message: known
              ? error.message
              : "Something went wrong. Please try again.",
            ...(known && error.fields ? { fields: error.fields } : {}),
            ...(known && error.retryAfterSeconds !== undefined
              ? { retryAfterSeconds: error.retryAfterSeconds }
              : {}),
          },
          requestId,
        },
        { status },
      );
      if (known && error.retryAfterSeconds !== undefined) {
        response.headers.set("Retry-After", String(error.retryAfterSeconds));
      }
    }
    response.headers.set("X-Request-ID", requestId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
}

export async function readRawBody(
  request: Request,
  limit = MAX_BODY_BYTES,
): Promise<string> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    throw new ApiError(
      413,
      "BODY_TOO_LARGE",
      "Request body exceeds the limit.",
    );
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new ApiError(
            413,
            "BODY_TOO_LARGE",
            "Request body exceeds the limit.",
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") || "",
    )
  ) {
    throw new ApiError(415, "JSON_REQUIRED", "Send an application/json body.");
  }
  const text = await readRawBody(request);
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body is not valid JSON.");
  }
  return parseInput(schema, input);
}

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      400,
      "INVALID_INPUT",
      "Please check the submitted fields.",
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
      })),
    );
  }
  return result.data;
}
