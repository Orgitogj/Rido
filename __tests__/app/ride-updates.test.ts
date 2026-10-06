import {
  notificationTarget,
  safeInternalRoute,
  usePendingRoute,
} from "@/lib/notificationRouting";
import {
  ACTION_LABEL,
  paymentNote,
  rideHeadline,
  STATUS_BADGE,
} from "@/lib/rideText";
import {
  type Cursors,
  type RideUpdate,
  UPDATES,
  watchSource,
} from "@/lib/rideUpdates";
import { rideStatuses } from "@/shared/contracts";
import { decodePolyline } from "@/shared/polyline";

import type { LiveTripView, RideView, WatchResponse } from "@/shared/contracts";

jest.mock("@clerk/expo", () => ({
  useAuth: () => ({ getToken: async () => null }),
}));
jest.mock("expo-router", () => ({ useFocusEffect: jest.fn() }));

const ride = (patch: Partial<RideView> = {}): RideView => ({
  id: "r1",
  viewer: "passenger",
  status: "requested",
  paymentStatus: "authorized",
  version: 1,
  fareCents: 1234,
  currency: "usd",
  pickup: { address: "A", latitude: 0, longitude: 0 },
  destination: { address: "B", latitude: 0, longitude: 0.05 },
  paymentMethod: "card_online",
  collection: null,
  distanceMeters: 5000,
  durationSeconds: 600,
  createdAt: "2026-01-01T00:00:00.000Z",
  requestedAt: "2026-01-01T00:00:00.000Z",
  searchDeadline: null,
  acceptedAt: null,
  arrivedAt: null,
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  driver: null,
  passengerName: null,
  legacyDemoDriver: null,
  allowedActions: ["cancel"],
  cancellation: null,
  rematchCount: 0,
  settlement: "none",
  chat: { state: "waiting", canSend: false, latestSeq: 0, unread: 0 },
  rating: {
    eligible: false,
    reason: "not_completed",
    stars: null,
    comment: null,
    submittedAt: null,
    editableUntil: null,
    canEdit: false,
    rateBy: null,
  },
  counterpartRating: null,
  serverTime: "2026-01-01T00:00:00.000Z",
  ...patch,
});

const flush = () =>
  new Promise((r) => jest.requireActual("timers").setImmediate(r));

const live = (patch: Partial<LiveTripView> = {}): LiveTripView => ({
  leg: "pickup",
  locationSeq: 1,
  locationStatus: "live",
  driverLocation: null,
  eta: null,
  routeVersion: 1,
  route: null,
  ...patch,
});

const changed = (
  r: RideView | null,
  l: LiveTripView | null = null,
): WatchResponse => ({
  changed: true,
  ride: r,
  live: l,
  serverTime: "2026-01-01T00:00:00.000Z",
});

const unchanged: WatchResponse = {
  changed: false,
  ride: null,
  live: null,
  serverTime: "2026-01-01T00:00:00.000Z",
};

const pump = async (ms = 0) => {
  await flush();
  jest.advanceTimersByTime(ms);
  await flush();
};

describe("watchSource", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("sends its latest cursors so a reconnect recovers everything missed", async () => {
    const seen: string[] = [];
    const responses: WatchResponse[] = [
      changed(
        ride({ version: 3 }),
        live({ locationSeq: 7, routeVersion: 2, route: { polyline: "abc" } }),
      ),
      unchanged,
    ];
    const fetchWatch = jest.fn(async (_id: string, cursors: Cursors) => {
      seen.push(
        `${cursors.version}/${cursors.locationSeq}/${cursors.routeVersion}`,
      );
      const next = responses.shift();
      if (!next) throw new Error("offline");
      return next;
    });
    const sub = watchSource(fetchWatch, jest.fn()).subscribe("r1", {
      onUpdate: () => {},
      onError: () => {},
    });
    await pump();
    await pump();
    await pump(1000);
    sub.close();
    expect(seen.slice(0, 3)).toEqual(["0/0/0", "3/7/2", "3/7/2"]);
  });

  it("advances the chat cursor and never moves it backwards", async () => {
    const seen: number[] = [];
    const chatAt = (latestSeq: number) => ({
      state: "open" as const,
      canSend: true,
      latestSeq,
      unread: 0,
    });
    const responses: WatchResponse[] = [
      changed(ride({ version: 2, chat: chatAt(4) })),
      changed(ride({ version: 2, chat: chatAt(3) })),
      unchanged,
    ];
    const fetchWatch = jest.fn(async (_id: string, cursors: Cursors) => {
      seen.push(cursors.chatSeq);
      const next = responses.shift();
      if (!next) throw new Error("offline");
      return next;
    });
    const sub = watchSource(fetchWatch, jest.fn()).subscribe("r1", {
      onUpdate: () => {},
      onError: () => {},
    });
    await pump();
    await pump();
    await pump();
    sub.close();
    expect(seen.slice(0, 3)).toEqual([0, 4, 4]);
  });

  it("ignores stale ride versions and older location sequences", async () => {
    const updates: RideUpdate[] = [];
    const responses = [
      changed(
        ride({ version: 5, status: "arriving" }),
        live({ locationSeq: 9 }),
      ),
      changed(
        ride({ version: 4, status: "accepted" }),
        live({ locationSeq: 8 }),
      ),
    ];
    const fetchWatch = jest.fn(async () => responses.shift() ?? unchanged);
    const sub = watchSource(fetchWatch, jest.fn()).subscribe("r1", {
      onUpdate: (u) => updates.push(u),
      onError: () => {},
    });
    await pump();
    await pump();
    await pump();
    sub.close();
    expect(updates).toHaveLength(1);
    expect(updates[0].ride?.status).toBe("arriving");
  });

  it("falls back to plain polling after repeated watch failures", async () => {
    const modes: string[] = [];
    const fetchWatch = jest.fn(async () => {
      throw new Error("watch unavailable");
    });
    const fetchRide = jest.fn(async () => ride({ version: 2 }));
    const updates: RideUpdate[] = [];
    const sub = watchSource(fetchWatch, fetchRide).subscribe("r1", {
      onUpdate: (u) => updates.push(u),
      onError: () => {},
      onMode: (m) => modes.push(m),
    });
    await pump();
    await pump(1000);
    await pump(2000);
    await pump();
    sub.close();
    expect(fetchWatch).toHaveBeenCalledTimes(UPDATES.failuresBeforeFallback);
    expect(fetchRide).toHaveBeenCalled();
    expect(modes).toContain("polling");
    expect(updates[0].ride?.version).toBe(2);
  });

  it("stops once the ride has ended", async () => {
    const fetchWatch = jest.fn(async () =>
      changed(ride({ status: "completed", version: 9 })),
    );
    watchSource(fetchWatch, jest.fn()).subscribe("r1", {
      onUpdate: () => {},
      onError: () => {},
    });
    await pump();
    await pump(30_000);
    expect(fetchWatch).toHaveBeenCalledTimes(1);
  });

  it("does nothing while paused and refreshes immediately on resume", async () => {
    const fetchWatch = jest.fn(async () => unchanged);
    const sub = watchSource(fetchWatch, jest.fn()).subscribe("r1", {
      onUpdate: () => {},
      onError: () => {},
    });
    sub.pause();
    await pump(60_000);
    expect(fetchWatch).toHaveBeenCalledTimes(0);
    sub.resume();
    await pump();
    expect(fetchWatch).toHaveBeenCalled();
    sub.close();
  });
});

describe("polyline", () => {
  it("decodes Google's reference polyline", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      { latitude: 38.5, longitude: -120.2 },
      { latitude: 40.7, longitude: -120.95 },
      { latitude: 43.252, longitude: -126.453 },
    ]);
  });

  it("rejects a truncated polyline", () => {
    expect(() => decodePolyline("_p~iF~ps|U_")).toThrow();
  });
});

describe("notification and deep-link routing", () => {
  const RIDE = "/ride/3f2b8c1e-9a4d-4c3b-8e2f-1a2b3c4d5e6f";

  it("only allows known in-app routes", () => {
    expect(safeInternalRoute(RIDE)).toBe(RIDE);
    expect(safeInternalRoute("/driver")).toBe("/driver");
    for (const bad of [
      "https://evil.example/ride/x",
      "//evil.example",
      "/ride/not-a-uuid",
      `${RIDE}/../../admin`,
      `${RIDE}?next=https://evil.example`,
      "/(root)/(tabs)/profile",
      null,
      42,
    ]) {
      expect(safeInternalRoute(bad)).toBeNull();
    }
  });

  it("opens a ride only for the account the notification was sent to", () => {
    const data = { target: RIDE, recipient: "user_alice" };
    expect(notificationTarget(data, "user_alice")).toEqual({
      action: "open",
      route: RIDE,
    });
    expect(notificationTarget(data, "user_bob")).toEqual({
      action: "ignore",
      reason: "other_account",
    });
  });

  it("sends a signed-out user to sign in and remembers the ride", () => {
    const data = { target: RIDE, recipient: "user_alice" };
    expect(notificationTarget(data, null)).toEqual({
      action: "sign_in",
      route: RIDE,
    });
    usePendingRoute.getState().remember(RIDE);
    expect(usePendingRoute.getState().take()).toBe(RIDE);
    expect(usePendingRoute.getState().take()).toBeNull();
  });

  it("ignores malformed or unsafe notification payloads", () => {
    expect(
      notificationTarget(
        { target: "https://evil.example", recipient: "user_alice" },
        "user_alice",
      ).action,
    ).toBe("ignore");
    expect(notificationTarget({ target: RIDE }, "user_alice").action).toBe(
      "ignore",
    );
    expect(notificationTarget(undefined, "user_alice").action).toBe("ignore");
    usePendingRoute.getState().remember("https://evil.example");
    expect(usePendingRoute.getState().take()).toBeNull();
  });
});

describe("ride text", () => {
  it("has a badge for every status", () => {
    for (const s of rideStatuses) expect(STATUS_BADGE[s].label).toBeTruthy();
  });

  it("distinguishes completed, cancelled, and no-driver outcomes", () => {
    expect(STATUS_BADGE.completed.label).toBe("Completed");
    expect(STATUS_BADGE.cancelled.label).toBe("Cancelled");
    expect(STATUS_BADGE.no_driver.label).toBe("No driver found");
  });

  it("explains who cancelled and whether money was taken", () => {
    expect(
      rideHeadline(ride({ status: "cancelled", cancelledBy: "driver" })),
    ).toMatch(/driver cancelled/i);
    expect(paymentNote("cancelled", "no_driver")).toMatch(/not charged/);
    expect(paymentNote("authorized", "offered")).toMatch(/charged only when/);
    expect(paymentNote("paid", "completed")).toMatch(/Charged/);
  });

  it("labels every driver action", () => {
    expect(Object.keys(ACTION_LABEL).sort()).toEqual(
      [
        "arrived",
        "arriving",
        "cancel",
        "completed",
        "in_progress",
        "interrupt",
      ].sort(),
    );
  });
});
