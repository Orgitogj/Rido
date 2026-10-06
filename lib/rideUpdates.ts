import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";

import { useApi } from "@/lib/fetch";
import { isTerminal } from "@/lib/rideText";

import type {
  LiveTripView,
  RideAction,
  RideView,
  WatchResponse,
} from "@/shared/contracts";

export interface RideUpdate {
  ride: RideView | null;
  live: LiveTripView | null;
}

export interface Cursors {
  version: number;
  locationSeq: number;
  routeVersion: number;
  chatSeq: number;
}

export interface Subscription {
  refreshNow(): void;
  pause(): void;
  resume(): void;
  close(): void;
}

export interface RideUpdateSource {
  subscribe(
    rideId: string,
    handlers: {
      onUpdate(update: RideUpdate): void;
      onError(error: unknown): void;
      onMode?(mode: "watch" | "polling"): void;
    },
  ): Subscription;
}

export const UPDATES = {
  waitSeconds: 20,
  pollIntervalMs: 3000,
  maxBackoffMs: 15_000,
  failuresBeforeFallback: 3,
  fallbackMs: 60_000,
} as const;

export type WatchFetcher = (
  rideId: string,
  cursors: Cursors & { wait: number },
  signal: AbortSignal,
) => Promise<WatchResponse>;

export type RideFetcher = (
  rideId: string,
  signal: AbortSignal,
) => Promise<RideView>;

export function watchSource(
  fetchWatch: WatchFetcher,
  fetchRide: RideFetcher,
  clock: { now(): number } = Date,
): RideUpdateSource {
  return {
    subscribe(rideId, { onUpdate, onError, onMode }) {
      const cursors: Cursors = {
        version: 0,
        locationSeq: 0,
        routeVersion: 0,
        chatSeq: 0,
      };
      let timer: ReturnType<typeof setTimeout> | null = null;
      let controller: AbortController | null = null;
      let closed = false;
      let paused = false;
      let finished = false;
      let failures = 0;
      let pollingUntil = 0;
      let generation = 0;

      const deliver = (update: RideUpdate) => {
        if (update.ride && update.ride.version < cursors.version) {
          update = { ...update, ride: null };
        }
        if (update.live && update.live.locationSeq < cursors.locationSeq) {
          update = { ...update, live: null };
        }
        if (update.ride) {
          cursors.version = update.ride.version;
          cursors.chatSeq = Math.max(
            cursors.chatSeq,
            update.ride.chat?.latestSeq ?? 0,
          );
          finished = isTerminal(update.ride.status);
        }
        if (update.live) {
          cursors.locationSeq = update.live.locationSeq;
          if (update.live.route)
            cursors.routeVersion = update.live.routeVersion;
        }
        if (update.ride || update.live) onUpdate(update);
      };

      const schedule = (ms: number) => {
        if (timer) clearTimeout(timer);
        timer = null;
        if (!closed && !paused && !finished) timer = setTimeout(run, ms);
      };

      const run = async () => {
        if (closed || paused || finished) return;
        const mine = ++generation;
        controller = new AbortController();
        const polling = clock.now() < pollingUntil;
        onMode?.(polling ? "polling" : "watch");
        try {
          if (polling) {
            const ride = await fetchRide(rideId, controller.signal);
            if (mine !== generation) return;
            deliver({ ride, live: null });
            failures = 0;
            schedule(UPDATES.pollIntervalMs);
          } else {
            const res = await fetchWatch(
              rideId,
              { ...cursors, wait: UPDATES.waitSeconds },
              controller.signal,
            );
            if (mine !== generation) return;
            if (res.changed) deliver({ ride: res.ride, live: res.live });
            failures = 0;
            schedule(0);
          }
        } catch (error) {
          if (mine !== generation || closed || paused) return;
          failures += 1;
          onError(error);
          if (!polling && failures >= UPDATES.failuresBeforeFallback) {
            pollingUntil = clock.now() + UPDATES.fallbackMs;
            failures = 0;
            schedule(0);
            return;
          }
          schedule(Math.min(UPDATES.maxBackoffMs, 1000 * 2 ** (failures - 1)));
        }
      };

      const stop = () => {
        generation++;
        controller?.abort();
        if (timer) clearTimeout(timer);
        timer = null;
      };

      schedule(0);
      return {
        refreshNow: () => {
          stop();
          finished = false;
          if (!closed && !paused) schedule(0);
        },
        pause: () => {
          paused = true;
          stop();
        },
        resume: () => {
          if (!paused) return;
          paused = false;
          schedule(0);
        },
        close: () => {
          closed = true;
          stop();
        },
      };
    },
  };
}

export type Connection = "connecting" | "live" | "reconnecting";

export function useRide(rideId: string) {
  const request = useApi();
  const [ride, setRide] = useState<RideView | null>(null);
  const [live, setLive] = useState<LiveTripView | null>(null);
  const [polyline, setPolyline] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [mode, setMode] = useState<"watch" | "polling">("watch");
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const subscription = useRef<Subscription | null>(null);

  const applyRide = useCallback((next: RideView) => {
    if (next.version < version.current) return;
    version.current = next.version;
    setRide((prev) =>
      prev &&
      prev.version === next.version &&
      prev.chat.latestSeq > next.chat.latestSeq
        ? prev
        : next,
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      version.current = 0;
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
          if (update.ride) applyRide(update.ride);
          if (update.live) {
            setLive(update.live);
            if (update.live.route) setPolyline(update.live.route.polyline);
            if (!update.live.leg) setPolyline(null);
          }
          setConnection("live");
          setError(null);
        },
        onError: (e) => {
          setConnection("reconnecting");
          setError(e instanceof Error ? e.message : "Connection problem");
        },
        onMode: setMode,
      });
      subscription.current = sub;
      const appState = AppState.addEventListener("change", (state) => {
        if (state === "active") sub.resume();
        else sub.pause();
      });
      return () => {
        appState.remove();
        sub.close();
        subscription.current = null;
      };
    }, [rideId, request, applyRide]),
  );

  const perform = useCallback(
    async (action: RideAction, detail?: string): Promise<"ok" | "left"> => {
      const path =
        action === "cancel"
          ? `/api/rides/${rideId}/cancel`
          : action === "interrupt"
            ? `/api/rides/${rideId}/interrupt`
            : action === "stop_reached"
              ? `/api/rides/${rideId}/stops`
              : `/api/rides/${rideId}/status`;
      const body =
        action === "cancel"
          ? {}
          : action === "interrupt"
            ? { reason: detail }
            : action === "stop_reached"
              ? { index: Number(detail) }
              : action === "in_progress" && detail
                ? { status: action, pin: detail }
                : { status: action };
      try {
        const next = await request<RideView | null>(path, { body });
        if (!next) {
          subscription.current?.close();
          return "left";
        }
        applyRide(next);
        return "ok";
      } finally {
        subscription.current?.refreshNow();
      }
    },
    [rideId, request, applyRide],
  );

  const recordCollection = useCallback(
    async (method: "pos" | "cash" | "unpaid") => {
      try {
        const next = await request<RideView>(
          `/api/rides/${rideId}/collection`,
          { body: { method } },
        );
        applyRide(next);
      } finally {
        subscription.current?.refreshNow();
      }
    },
    [rideId, request, applyRide],
  );

  return {
    ride,
    live,
    polyline,
    connection,
    mode,
    error,
    perform,
    recordCollection,
  };
}
