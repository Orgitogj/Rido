import type { ChatMessageView } from "@/shared/contracts";

export type Delivery = "sending" | "sent" | "failed";

export interface ChatItem {
  key: string;
  id: string | null;
  clientMessageId: string | null;
  seq: number | null;
  body: string;
  mine: boolean;
  createdAt: string;
  delivery: Delivery;
  error: string | null;
  earlierDriver: boolean;
}

const fromServer = (m: ChatMessageView): ChatItem => ({
  key: m.clientMessageId ? `c:${m.clientMessageId}` : `m:${m.id}`,
  id: m.id,
  clientMessageId: m.clientMessageId,
  seq: m.seq,
  body: m.body,
  mine: m.mine,
  createdAt: m.createdAt,
  delivery: "sent",
  error: null,
  earlierDriver: m.earlierDriver,
});

export function sortItems(items: ChatItem[]): ChatItem[] {
  return [...items].sort((a, b) => {
    if (a.seq !== null && b.seq !== null) return a.seq - b.seq;
    if (a.seq !== null) return -1;
    if (b.seq !== null) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function mergeServer(
  items: ChatItem[],
  messages: ChatMessageView[],
): ChatItem[] {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const seenIds = new Set(items.map((i) => i.id).filter(Boolean));
  for (const m of messages) {
    const next = fromServer(m);
    if (seenIds.has(m.id) && !byKey.has(next.key)) continue;
    byKey.set(next.key, next);
    seenIds.add(m.id);
  }
  return sortItems([...byKey.values()]);
}

export function addPending(
  items: ChatItem[],
  clientMessageId: string,
  body: string,
  now: Date,
): ChatItem[] {
  const key = `c:${clientMessageId}`;
  if (items.some((i) => i.key === key)) return items;
  return sortItems([
    ...items,
    {
      key,
      id: null,
      clientMessageId,
      seq: null,
      body,
      mine: true,
      createdAt: now.toISOString(),
      delivery: "sending",
      error: null,
      earlierDriver: false,
    },
  ]);
}

export function setDelivery(
  items: ChatItem[],
  clientMessageId: string,
  delivery: Exclude<Delivery, "sent">,
  error: string | null = null,
): ChatItem[] {
  const key = `c:${clientMessageId}`;
  return items.map((i) =>
    i.key === key && i.delivery !== "sent" ? { ...i, delivery, error } : i,
  );
}

export function maxSeq(items: ChatItem[]): number {
  return items.reduce(
    (max, i) => (i.seq !== null && i.seq > max ? i.seq : max),
    0,
  );
}

export function minSeq(items: ChatItem[]): number | null {
  const seqs = items.map((i) => i.seq).filter((s): s is number => s !== null);
  return seqs.length ? Math.min(...seqs) : null;
}

export function latestIncomingSeq(items: ChatItem[]): number {
  return items.reduce(
    (max, i) => (!i.mine && i.seq !== null && i.seq > max ? i.seq : max),
    0,
  );
}

export function pendingItem(items: ChatItem[], clientMessageId: string) {
  return items.find((i) => i.key === `c:${clientMessageId}`) ?? null;
}
