import { useCallback } from "react";
import { create } from "zustand";

import { useApi } from "@/lib/fetch";
import { registerUserReset } from "@/lib/session";

import type { InboxItem, InboxPage } from "@/shared/account";

interface InboxState {
  items: InboxItem[];
  unread: number;
  nextCursor: string | null;
  status: "idle" | "loading" | "ready" | "error";
  error: unknown;
  clear: () => void;
}

export const useInboxStore = create<InboxState>((set) => ({
  items: [],
  unread: 0,
  nextCursor: null,
  status: "idle",
  error: null,
  clear: () =>
    set({
      items: [],
      unread: 0,
      nextCursor: null,
      status: "idle",
      error: null,
    }),
}));

registerUserReset(() => useInboxStore.getState().clear());

export function mergeInbox(current: InboxItem[], incoming: InboxItem[]) {
  const seen = new Set(current.map((i) => i.id));
  return [...current, ...incoming.filter((i) => !seen.has(i.id))];
}

export function useInbox() {
  const request = useApi();
  const state = useInboxStore();

  const reload = useCallback(async () => {
    useInboxStore.setState({ status: "loading", error: null });
    try {
      const page = await request<InboxPage>("/api/notifications?limit=20");
      useInboxStore.setState({
        items: page.items,
        unread: page.unread,
        nextCursor: page.nextCursor,
        status: "ready",
      });
    } catch (error) {
      useInboxStore.setState({ status: "error", error });
    }
  }, [request]);

  const loadMore = useCallback(async () => {
    const { nextCursor, items } = useInboxStore.getState();
    if (!nextCursor) return;
    useInboxStore.setState({ status: "loading", error: null });
    try {
      const page = await request<InboxPage>(
        `/api/notifications?limit=20&cursor=${nextCursor}`,
      );
      useInboxStore.setState({
        items: mergeInbox(items, page.items),
        unread: page.unread,
        nextCursor: page.nextCursor,
        status: "ready",
      });
    } catch (error) {
      useInboxStore.setState({ status: "error", error });
    }
  }, [request]);

  const applyRead = (ids: string[] | null, unread: number) => {
    const now = new Date().toISOString();
    useInboxStore.setState((s) => ({
      unread,
      items: s.items.map((i) =>
        !i.readAt && (ids === null || ids.includes(i.id))
          ? { ...i, readAt: now }
          : i,
      ),
    }));
  };

  const markRead = useCallback(
    async (ids: string[]) => {
      try {
        const { unread } = await request<{ unread: number }>(
          "/api/notifications/read",
          { body: { ids } },
        );
        applyRead(ids, unread);
      } catch {}
    },
    [request],
  );

  const markAllRead = useCallback(async () => {
    try {
      const { unread } = await request<{ unread: number }>(
        "/api/notifications/read",
        { body: { all: true } },
      );
      applyRead(null, unread);
    } catch {}
  }, [request]);

  return { ...state, reload, loadMore, markRead, markAllRead };
}
