import * as Crypto from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  addPending,
  type ChatItem,
  latestIncomingSeq,
  maxSeq,
  mergeServer,
  minSeq,
  pendingItem,
  setDelivery,
} from "@/lib/chatThread";
import { ApiRequestError, useApi } from "@/lib/fetch";
import { setActiveChat } from "@/lib/notifications";
import { type Subscription, watchSource } from "@/lib/rideUpdates";

import type {
  ChatPage,
  ChatSendResult,
  ChatView,
  RideView,
  WatchResponse,
} from "@/shared/contracts";

export type ChatLoad = "loading" | "ready" | "error" | "not_found";

const errorText = (e: unknown) =>
  e instanceof ApiRequestError
    ? e.code === "RATE_LIMITED"
      ? "Sending too fast. Tap to retry in a moment."
      : e.message
    : "Couldn't send. Tap to retry.";

export function useChat(rideId: string) {
  const request = useApi();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [chat, setChat] = useState<ChatView | null>(null);
  const [load, setLoad] = useState<ChatLoad>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [connection, setConnection] = useState<"live" | "reconnecting">("live");
  const itemsRef = useRef<ChatItem[]>([]);
  const fetching = useRef(false);
  const again = useRef(false);
  const readSent = useRef(0);
  const subscription = useRef<Subscription | null>(null);

  const apply = useCallback((next: (prev: ChatItem[]) => ChatItem[]) => {
    setItems((prev) => {
      const value = next(prev);
      itemsRef.current = value;
      return value;
    });
  }, []);

  const applyChat = useCallback((next: ChatView) => {
    setChat((prev) =>
      prev && prev.latestSeq > next.latestSeq
        ? { ...next, latestSeq: prev.latestSeq }
        : next,
    );
  }, []);

  const fetchNewer = useCallback(async () => {
    if (fetching.current) {
      again.current = true;
      return;
    }
    fetching.current = true;
    try {
      do {
        again.current = false;
        let more = true;
        while (more) {
          const page = await request<ChatPage>(
            `/api/rides/${rideId}/messages?after=${maxSeq(itemsRef.current)}&limit=50`,
          );
          apply((prev) => mergeServer(prev, page.messages));
          applyChat(page.chat);
          more = page.hasMoreAfter && page.messages.length > 0;
        }
      } while (again.current);
    } finally {
      fetching.current = false;
    }
  }, [request, rideId, apply, applyChat]);

  const loadInitial = useCallback(async () => {
    setLoad("loading");
    try {
      const page = await request<ChatPage>(`/api/rides/${rideId}/messages`);
      apply((prev) => mergeServer(prev, page.messages));
      applyChat(page.chat);
      setHasMoreBefore(page.hasMoreBefore);
      setLoad("ready");
      setLoadError(null);
      return true;
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 404) {
        setLoad("not_found");
      } else {
        setLoad("error");
        setLoadError(
          e instanceof Error ? e.message : "Couldn't load messages.",
        );
      }
      return false;
    }
  }, [request, rideId, apply, applyChat]);

  useFocusEffect(
    useCallback(() => {
      let closed = false;
      setActiveChat(rideId);
      const start = async () => {
        if (!(await loadInitial()) || closed) return;
        const source = watchSource(
          (id, cursors, signal) =>
            request<WatchResponse>(
              `/api/rides/${id}/watch?version=${cursors.version}&locationSeq=${cursors.locationSeq}&routeVersion=${cursors.routeVersion}&chatSeq=${cursors.chatSeq}&wait=${cursors.wait}`,
              { signal, timeoutMs: (cursors.wait + 10) * 1000 },
            ),
          (id, signal) => request<RideView>(`/api/rides/${id}`, { signal }),
        );
        const sub = source.subscribe(rideId, {
          onUpdate: (update) => {
            setConnection("live");
            const ride = update.ride;
            if (!ride) return;
            setChat((prev) =>
              prev
                ? {
                    ...prev,
                    state: ride.chat.state,
                    canSend: ride.chat.canSend,
                  }
                : prev,
            );
            if (ride.chat.latestSeq > maxSeq(itemsRef.current)) {
              fetchNewer().catch(() => setConnection("reconnecting"));
            }
          },
          onError: () => setConnection("reconnecting"),
        });
        subscription.current = sub;
      };
      start();
      const appState = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          subscription.current?.resume();
          fetchNewer().catch(() => setConnection("reconnecting"));
        } else subscription.current?.pause();
      });
      return () => {
        closed = true;
        setActiveChat(null);
        appState.remove();
        subscription.current?.close();
        subscription.current = null;
      };
    }, [rideId, request, loadInitial, fetchNewer]),
  );

  useEffect(() => {
    const seq = latestIncomingSeq(items);
    if (load !== "ready" || seq <= readSent.current) return;
    if (chat && seq <= chat.readSeq) return;
    readSent.current = seq;
    request<ChatView>(`/api/rides/${rideId}/messages/read`, {
      body: { seq },
    })
      .then(applyChat)
      .catch(() => {
        readSent.current = 0;
      });
  }, [items, load, chat, request, rideId, applyChat]);

  const deliver = useCallback(
    async (clientMessageId: string, body: string) => {
      apply((prev) => setDelivery(prev, clientMessageId, "sending"));
      try {
        const result = await request<ChatSendResult>(
          `/api/rides/${rideId}/messages`,
          { body: { clientMessageId, body } },
        );
        apply((prev) => mergeServer(prev, [result.message]));
        applyChat(result.chat);
        subscription.current?.refreshNow();
      } catch (e) {
        apply((prev) =>
          setDelivery(prev, clientMessageId, "failed", errorText(e)),
        );
        if (e instanceof ApiRequestError && e.code === "CHAT_CLOSED") {
          subscription.current?.refreshNow();
        }
      }
    },
    [request, rideId, apply, applyChat],
  );

  const send = useCallback(
    (text: string) => {
      const body = text.replace(/\r\n?/g, "\n").trim();
      if (!body) return;
      const clientMessageId = Crypto.randomUUID();
      apply((prev) => addPending(prev, clientMessageId, body, new Date()));
      return deliver(clientMessageId, body);
    },
    [apply, deliver],
  );

  const retry = useCallback(
    (clientMessageId: string) => {
      const item = pendingItem(itemsRef.current, clientMessageId);
      if (!item || item.delivery === "sent" || item.delivery === "sending")
        return;
      return deliver(clientMessageId, item.body);
    },
    [deliver],
  );

  const loadOlder = useCallback(async () => {
    const before = minSeq(itemsRef.current);
    if (!hasMoreBefore || loadingOlder || before === null) return;
    setLoadingOlder(true);
    try {
      const page = await request<ChatPage>(
        `/api/rides/${rideId}/messages?before=${before}`,
      );
      apply((prev) => mergeServer(prev, page.messages));
      setHasMoreBefore(page.hasMoreBefore);
    } catch {
      return;
    } finally {
      setLoadingOlder(false);
    }
  }, [hasMoreBefore, loadingOlder, request, rideId, apply]);

  return {
    items,
    chat,
    load,
    loadError,
    connection,
    hasMoreBefore,
    loadingOlder,
    send,
    retry,
    loadOlder,
    reload: loadInitial,
  };
}
