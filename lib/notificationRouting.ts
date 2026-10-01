import { create } from "zustand";

const RIDE_ROUTE =
  /^\/ride\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RECEIPT_ROUTE =
  /^\/receipt\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CHAT_ROUTE =
  /^\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

const SUPPORT_ROUTE =
  /^\/support\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SAFETY_ROUTE =
  /^\/safety\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function safeInternalRoute(path: unknown): string | null {
  if (typeof path !== "string") return null;
  if (path === "/driver" || path === "/admin" || path === "/notifications") {
    return path;
  }
  if (SUPPORT_ROUTE.test(path)) return path.toLowerCase();
  if (SAFETY_ROUTE.test(path)) return path.toLowerCase();
  if (RIDE_ROUTE.test(path)) return path.toLowerCase();
  if (RECEIPT_ROUTE.test(path)) return path.toLowerCase();
  if (CHAT_ROUTE.test(path)) return path.toLowerCase();
  return null;
}

export function chatRideId(route: string): string | null {
  return CHAT_ROUTE.exec(route)?.[1]?.toLowerCase() ?? null;
}

export async function authorizeRoute(
  route: string,
  canOpenChat: (rideId: string) => Promise<boolean>,
): Promise<string | null> {
  const safe = safeInternalRoute(route);
  if (!safe) return null;
  const rideId = chatRideId(safe);
  if (!rideId) return safe;
  try {
    return (await canOpenChat(rideId)) ? safe : null;
  } catch {
    return null;
  }
}

export type TargetDecision =
  | { action: "open"; route: string }
  | { action: "sign_in"; route: string }
  | { action: "ignore"; reason: "invalid" | "other_account" };

export function notificationTarget(
  data: unknown,
  currentClerkId: string | null | undefined,
): TargetDecision {
  const payload = (data ?? {}) as { target?: unknown; recipient?: unknown };
  const route = safeInternalRoute(payload.target);
  if (!route || typeof payload.recipient !== "string") {
    return { action: "ignore", reason: "invalid" };
  }
  if (!currentClerkId) return { action: "sign_in", route };
  if (payload.recipient !== currentClerkId) {
    return { action: "ignore", reason: "other_account" };
  }
  return { action: "open", route };
}

interface PendingRouteStore {
  route: string | null;
  remember: (route: string | null) => void;
  take: () => string | null;
}

export const usePendingRoute = create<PendingRouteStore>((set, get) => ({
  route: null,
  remember: (route) => set({ route: safeInternalRoute(route) }),
  take: () => {
    const route = get().route;
    set({ route: null });
    return route;
  },
}));
