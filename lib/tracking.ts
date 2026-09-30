import { getClerkInstance } from "@clerk/expo";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { apiRequest } from "@/lib/fetch";

import type { LocationUpdateResult } from "@/shared/contracts";

export const BACKGROUND_LOCATION_TASK = "driver-location-updates";

export const TRACKING = {
  sendEveryMs: 5000,
  distanceMeters: 15,
  weakAccuracyMeters: 100,
  backgroundIntervalMs: 15_000,
  backgroundDistanceMeters: 50,
} as const;

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  recordedAt: string;
}

export const toFix = (position: Location.LocationObject): Fix => ({
  latitude: position.coords.latitude,
  longitude: position.coords.longitude,
  accuracy: position.coords.accuracy ?? null,
  heading: position.coords.heading ?? null,
  speed: position.coords.speed ?? null,
  recordedAt: new Date(position.timestamp).toISOString(),
});

export const backgroundSupported = () =>
  Platform.OS !== "web" &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

async function sendFix(fix: Fix, token: string | null | undefined) {
  if (!token) throw new Error("Not signed in");
  return apiRequest<LocationUpdateResult>("/api/driver/location", {
    body: fix,
    token,
  });
}

if (Platform.OS !== "web") {
  TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(
    BACKGROUND_LOCATION_TASK,
    async ({ data, error }) => {
      if (error || !data?.locations?.length) return;
      const latest = data.locations[data.locations.length - 1];
      try {
        const token = await getClerkInstance().session?.getToken();
        const result = await sendFix(toFix(latest), token);
        if (!result.sharing) {
          await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        }
      } catch {
        return;
      }
    },
  );
}

export async function stopBackgroundTracking() {
  if (!backgroundSupported()) return;
  try {
    if (
      await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
    ) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch {
    return;
  }
}

export type PermissionState = "unknown" | "granted" | "denied" | "services_off";

export async function foregroundPermission(
  ask: boolean,
): Promise<PermissionState> {
  if (!(await Location.hasServicesEnabledAsync())) return "services_off";
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return "granted";
  if (!ask) return current.canAskAgain ? "unknown" : "denied";
  const asked = await Location.requestForegroundPermissionsAsync();
  return asked.granted ? "granted" : "denied";
}

export async function currentFix(): Promise<Fix | null> {
  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return toFix(position);
  } catch {
    return null;
  }
}

export type TrackingState =
  "off" | "starting" | "tracking" | "denied" | "services_off" | "unavailable";

export interface TrackingStatus {
  state: TrackingState;
  lastSentAt: number | null;
  lastProblem: null | "offline" | "weak_gps" | "rejected" | "not_sharing";
  accuracy: number | null;
  background: "unsupported" | "off" | "on" | "denied";
}

export function useDriverTracking(
  active: boolean,
  wantBackground: boolean,
  getToken: () => Promise<string | null>,
) {
  const [status, setStatus] = useState<TrackingStatus>({
    state: "off",
    lastSentAt: null,
    lastProblem: null,
    accuracy: null,
    background: backgroundSupported() ? "off" : "unsupported",
  });
  const lastSent = useRef(0);
  const pending = useRef<Fix | null>(null);
  const sending = useRef(false);

  const flush = useCallback(async () => {
    const fix = pending.current;
    if (!fix || sending.current) return;
    if (Date.now() - lastSent.current < TRACKING.sendEveryMs) return;
    sending.current = true;
    try {
      const result = await sendFix(fix, await getToken());
      lastSent.current = Date.now();
      if (pending.current === fix) pending.current = null;
      setStatus((s) => ({
        ...s,
        lastSentAt: result.accepted ? Date.now() : s.lastSentAt,
        lastProblem: !result.sharing
          ? "not_sharing"
          : result.reason === "low_accuracy"
            ? "weak_gps"
            : result.accepted || result.reason === "throttled"
              ? null
              : "rejected",
      }));
    } catch {
      setStatus((s) => ({ ...s, lastProblem: "offline" }));
    } finally {
      sending.current = false;
    }
  }, [getToken]);

  useEffect(() => {
    if (!active) {
      setStatus((s) => ({ ...s, state: "off", lastProblem: null }));
      stopBackgroundTracking();
      return;
    }
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;
    const retry = setInterval(flush, TRACKING.sendEveryMs);

    (async () => {
      setStatus((s) => ({ ...s, state: "starting" }));
      const permission = await foregroundPermission(false).catch(
        () => "unknown" as const,
      );
      if (cancelled) return;
      if (permission !== "granted") {
        setStatus((s) => ({
          ...s,
          state: permission === "services_off" ? "services_off" : "denied",
        }));
        return;
      }
      try {
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: TRACKING.sendEveryMs,
            distanceInterval: TRACKING.distanceMeters,
          },
          (position) => {
            const fix = toFix(position);
            pending.current = fix;
            setStatus((s) => ({
              ...s,
              state: "tracking",
              accuracy: fix.accuracy,
              lastProblem:
                fix.accuracy !== null &&
                fix.accuracy > TRACKING.weakAccuracyMeters
                  ? "weak_gps"
                  : s.lastProblem === "weak_gps"
                    ? null
                    : s.lastProblem,
            }));
            flush();
          },
        );
        if (cancelled) subscription.remove();
      } catch {
        if (!cancelled) setStatus((s) => ({ ...s, state: "unavailable" }));
      }
    })();

    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") flush();
    });
    return () => {
      cancelled = true;
      clearInterval(retry);
      appState.remove();
      subscription?.remove();
    };
  }, [active, flush]);

  useEffect(() => {
    if (!backgroundSupported()) return;
    let cancelled = false;
    (async () => {
      if (!active || !wantBackground) {
        await stopBackgroundTracking();
        if (!cancelled) {
          setStatus((s) => ({ ...s, background: "off" }));
        }
        return;
      }
      try {
        const permission = await Location.requestBackgroundPermissionsAsync();
        if (!permission.granted) {
          if (!cancelled) setStatus((s) => ({ ...s, background: "denied" }));
          return;
        }
        await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: TRACKING.backgroundIntervalMs,
          distanceInterval: TRACKING.backgroundDistanceMeters,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          activityType: Location.ActivityType.AutomotiveNavigation,
          foregroundService: {
            notificationTitle: "Sharing your location",
            notificationBody:
              "Riders and dispatch see your position while you're online.",
            notificationColor: "#0286FF",
          },
        });
        if (!cancelled) setStatus((s) => ({ ...s, background: "on" }));
      } catch {
        if (!cancelled) setStatus((s) => ({ ...s, background: "denied" }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, wantBackground]);

  return status;
}
