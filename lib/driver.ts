import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";

import { ApiRequestError, useApi } from "@/lib/fetch";

import type { DriverDashboard } from "@/shared/contracts";

const HEARTBEAT_MS = 4000;

export function useDriverDashboard() {
  const request = useApi();
  const [data, setData] = useState<DriverDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);

  const beat = useCallback(async () => {
    const id = ++latest.current;
    try {
      const next = await request<DriverDashboard>("/api/driver/heartbeat", {
        body: {},
      });
      if (id !== latest.current) return;
      setData(next);
      setReceivedAt(Date.now());
      setError(null);
    } catch (e) {
      if (id === latest.current) {
        setError(
          e instanceof ApiRequestError ? e.message : "Connection problem",
        );
      }
    }
  }, [request]);

  useFocusEffect(
    useCallback(() => {
      let stopped = false;
      const loop = async () => {
        await beat();
        if (!stopped) timer.current = setTimeout(loop, HEARTBEAT_MS);
      };
      loop();
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active" && !stopped) beat();
      });
      return () => {
        stopped = true;
        sub.remove();
        if (timer.current) clearTimeout(timer.current);
      };
    }, [beat]),
  );

  const replace = useCallback((next: DriverDashboard) => {
    latest.current++;
    setData(next);
    setReceivedAt(Date.now());
  }, []);

  return { data, error, receivedAt, refresh: beat, replace };
}
