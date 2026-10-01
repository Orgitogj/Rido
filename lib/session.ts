import { useAuth } from "@clerk/expo";
import { router } from "expo-router";
import { useCallback, useEffect, useRef } from "react";

import { useApi } from "@/lib/fetch";
import { useLanguage } from "@/lib/i18n";
import { unregisterPush } from "@/lib/notifications";
import { stopBackgroundTracking } from "@/lib/tracking";
import { useLocationStore, useRideStore } from "@/store";

const resetters = new Set<() => void>();

export function registerUserReset(reset: () => void) {
  resetters.add(reset);
}

export function resetUserState() {
  useRideStore.getState().clear();
  useLocationStore.getState().reset();
  for (const reset of resetters) reset();
}

export function useSignOut() {
  const { signOut } = useAuth();
  const request = useApi();
  return useCallback(async () => {
    await stopBackgroundTracking().catch(() => {});
    await unregisterPush(request).catch(() => {});
    resetUserState();
    await signOut();
    router.replace("/(auth)/sign-in");
  }, [request, signOut]);
}

export function useAccountBoundary() {
  const { userId, isSignedIn } = useAuth();
  const request = useApi();
  const language = useLanguage((s) => s.language);
  const ready = useLanguage((s) => s.ready);
  const last = useRef<string | null>(null);
  const synced = useRef<string | null>(null);

  useEffect(() => {
    if (!isSignedIn || !userId) {
      if (last.current) resetUserState();
      last.current = null;
      synced.current = null;
      return;
    }
    if (last.current && last.current !== userId) {
      resetUserState();
      synced.current = null;
    }
    last.current = userId;
  }, [userId, isSignedIn]);

  useEffect(() => {
    if (!isSignedIn || !userId || !ready) return;
    const key = `${userId}:${language}`;
    if (synced.current === key) return;
    synced.current = key;
    request("/api/me", { method: "PATCH", body: { language } }).catch(() => {
      synced.current = null;
    });
  }, [isSignedIn, userId, language, ready, request]);
}
