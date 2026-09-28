import {
  addPending,
  type ChatItem,
  latestIncomingSeq,
  maxSeq,
  mergeServer,
  minSeq,
  setDelivery,
} from "@/lib/chatThread";
import {
  authorizeRoute,
  chatRideId,
  notificationTarget,
  safeInternalRoute,
} from "@/lib/notificationRouting";
import { formatRating } from "@/lib/ratingText";

import type { ChatMessageView } from "@/shared/contracts";

const RIDE = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const server = (
  seq: number,
  patch: Partial<ChatMessageView> = {},
): ChatMessageView => ({
  id: `id-${seq}`,
  seq,
  mine: false,
  clientMessageId: null,
  body: `m${seq}`,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
  earlierDriver: false,
  ...patch,
});

const bodies = (items: ChatItem[]) => items.map((i) => i.body);

describe("chat thread reconciliation", () => {
  it("replaces an optimistic message with the server copy exactly once", () => {
    let items = mergeServer([], [server(1)]);
    items = addPending(items, "c-1", "hello", new Date("2026-01-01T00:01:00Z"));
    expect(items.map((i) => [i.body, i.delivery])).toEqual([
      ["m1", "sent"],
      ["hello", "sending"],
    ]);

    const confirmed = server(2, {
      mine: true,
      clientMessageId: "c-1",
      body: "hello",
    });
    items = mergeServer(items, [confirmed]);
    items = mergeServer(items, [confirmed, server(1)]);
    expect(bodies(items)).toEqual(["m1", "hello"]);
    expect(items[1]).toMatchObject({ seq: 2, delivery: "sent", id: "id-2" });
  });

  it("keeps the same key for retries so a resend cannot duplicate", () => {
    let items = addPending([], "c-9", "are you close?", new Date());
    items = setDelivery(items, "c-9", "failed", "Couldn't send.");
    expect(items[0]).toMatchObject({
      delivery: "failed",
      error: "Couldn't send.",
    });
    items = addPending(items, "c-9", "are you close?", new Date());
    expect(items).toHaveLength(1);
    items = setDelivery(items, "c-9", "sending");
    items = mergeServer(items, [
      server(5, { mine: true, clientMessageId: "c-9", body: "are you close?" }),
    ]);
    items = setDelivery(items, "c-9", "failed", "late error");
    expect(items).toHaveLength(1);
    expect(items[0].delivery).toBe("sent");
  });

  it("orders out-of-order pages by sequence and keeps pending messages last", () => {
    let items = addPending(
      [],
      "c-x",
      "draft",
      new Date("2026-01-01T00:00:00Z"),
    );
    items = mergeServer(items, [server(7), server(8)]);
    items = mergeServer(items, [server(3), server(5)]);
    items = mergeServer(items, [server(8), server(6)]);
    expect(bodies(items)).toEqual(["m3", "m5", "m6", "m7", "m8", "draft"]);
    expect(maxSeq(items)).toBe(8);
    expect(minSeq(items)).toBe(3);
    expect(
      latestIncomingSeq([
        ...items,
        ...mergeServer([], [server(9, { mine: true })]),
      ]),
    ).toBe(8);
  });
});

describe("chat deep links", () => {
  it("allows only well-formed chat routes", () => {
    expect(safeInternalRoute(`/chat/${RIDE}`)).toBe(`/chat/${RIDE}`);
    expect(chatRideId(`/chat/${RIDE.toUpperCase()}`)).toBe(RIDE);
    for (const bad of [
      "/chat/abc",
      `/chat/${RIDE}/extra`,
      `/chat/${RIDE}?x=1`,
      `//chat/${RIDE}`,
    ]) {
      expect(safeInternalRoute(bad)).toBeNull();
    }
    expect(
      notificationTarget(
        { target: `/chat/${RIDE}`, recipient: "user_b" },
        "user_a",
      ),
    ).toEqual({ action: "ignore", reason: "other_account" });
  });

  it("opens a conversation only after the server authorizes it", async () => {
    const allow = jest.fn(async () => true);
    const deny = jest.fn(async () => false);
    const fail = jest.fn(async () => {
      throw new Error("404");
    });
    expect(await authorizeRoute(`/chat/${RIDE}`, allow)).toBe(`/chat/${RIDE}`);
    expect(allow).toHaveBeenCalledWith(RIDE);
    expect(await authorizeRoute(`/chat/${RIDE}`, deny)).toBeNull();
    expect(await authorizeRoute(`/chat/${RIDE}`, fail)).toBeNull();

    const untouched = jest.fn(async () => false);
    expect(await authorizeRoute(`/ride/${RIDE}`, untouched)).toBe(
      `/ride/${RIDE}`,
    );
    expect(await authorizeRoute("https://evil.example", untouched)).toBeNull();
    expect(untouched).not.toHaveBeenCalled();
  });
});

describe("rating summaries", () => {
  it("hides the average until there are enough ratings", () => {
    expect(formatRating(null)).toBe("New · no ratings yet");
    expect(formatRating({ count: 0, average: null })).toBe(
      "New · no ratings yet",
    );
    expect(formatRating({ count: 2, average: null })).toBe("New · 2 ratings");
    expect(formatRating({ count: 12, average: 4.8 })).toBe(
      "4.8 ★ · 12 ratings",
    );
  });
});
