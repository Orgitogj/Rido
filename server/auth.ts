import { verifyToken } from "@clerk/backend";

import { requireEnv, unauthenticated } from "./errors";

export interface Identity {
  clerkId: string;
}
export type Authenticate = (request: Request) => Promise<Identity>;

export function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{1,8192})$/.exec(header);
  if (!match) throw unauthenticated();
  return match[1];
}

export function clerkAuthenticator(env = process.env): Authenticate {
  return async (request) => {
    const token = bearerToken(request);
    const jwtKey = env.CLERK_JWT_KEY?.replace(/\\n/g, "\n");
    const secretKey = jwtKey
      ? env.CLERK_SECRET_KEY
      : requireEnv("CLERK_SECRET_KEY");
    const authorizedParties = (env.CLERK_AUTHORIZED_PARTIES ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    let payload: { sub?: unknown; sid?: unknown };
    try {
      payload = await verifyToken(token, {
        jwtKey,
        secretKey,
        authorizedParties: authorizedParties.length
          ? authorizedParties
          : undefined,
      });
    } catch {
      throw unauthenticated(
        "Your session could not be verified. Please sign in again.",
      );
    }
    if (typeof payload.sub !== "string" || !payload.sub.startsWith("user_")) {
      throw unauthenticated(
        "Your session could not be verified. Please sign in again.",
      );
    }
    return { clerkId: payload.sub };
  };
}
