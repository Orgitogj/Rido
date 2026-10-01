import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ListState from "@/components/ListState";
import { ApiRequestError, apiRequest } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";

import type { SharedTripView } from "@/shared/contracts";

const REFRESH_MS = 15_000;

const SharedTrip = () => {
  const { t, language } = useI18n();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [trip, setTrip] = useState<SharedTripView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "ended" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const data = await apiRequest<SharedTripView>(
        `/api/share/${encodeURIComponent(String(token))}`,
      );
      if (mine !== latest.current) return;
      setTrip(data);
      setState("ready");
      setError(null);
    } catch (e) {
      if (mine !== latest.current) return;
      if (
        e instanceof ApiRequestError &&
        (e.status === 404 || e.status === 400)
      ) {
        setTrip(null);
        setState("ended");
      } else {
        setState((s) => (s === "ready" ? "ready" : "error"));
        setError(e instanceof Error ? e.message : "Couldn't load the trip.");
      }
    }
  }, [token]);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (state !== "ended") load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, state]);

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <View className="px-5 py-6">
        <Text
          className="text-2xl font-JakartaExtraBold"
          accessibilityRole="header"
        >
          {t("safety.shared.title")}
        </Text>
        <Text className="text-xs text-general-200 mt-1">
          {t("safety.shared.intro")}
        </Text>
        <Text className="text-xs text-red-700 mt-2">
          {t("safety.emergency")}
        </Text>

        {state === "loading" && (
          <ListState kind="loading" message={t("safety.shared.loading")} />
        )}
        {state === "ended" && (
          <ListState kind="empty" message={t("safety.shared.ended")} />
        )}
        {state === "error" && (
          <ListState
            kind="error"
            message={
              language === "en" && error ? error : t("safety.shared.loadFailed")
            }
            onRetry={load}
          />
        )}

        {trip && state === "ready" && (
          <View className="bg-white rounded-2xl p-5 mt-4">
            <Text
              className="text-xl font-JakartaBold"
              accessibilityLiveRegion="polite"
            >
              {t(`safety.shared.status.${trip.status}`)}
            </Text>
            {trip.driver && (
              <Text className="text-sm mt-2">
                {trip.driver.firstName} · {trip.driver.vehicle} ·{" "}
                {trip.driver.plate}
              </Text>
            )}
            {trip.destination && (
              <Text className="text-sm text-general-200 mt-2">
                {t("safety.shared.headingTo", {
                  destination: trip.destination,
                })}
              </Text>
            )}
            {trip.driverLocation ? (
              <Pressable
                accessibilityRole="link"
                className="min-h-[44px] justify-center mt-2"
                onPress={() =>
                  Linking.openURL(
                    `https://www.google.com/maps/search/?api=1&query=${trip.driverLocation!.latitude},${trip.driverLocation!.longitude}`,
                  ).catch(() => undefined)
                }
              >
                <Text className="text-sm text-[#0066CC]">
                  {trip.driverLocation.freshness === "live"
                    ? t("safety.shared.positionLive")
                    : t("safety.shared.positionRecent")}
                </Text>
              </Pressable>
            ) : (
              <Text className="text-xs text-general-200 mt-3">
                {t("safety.shared.noPosition")}
              </Text>
            )}
            {error && (
              <Text className="text-xs text-orange-800 mt-3">
                {t("safety.shared.stale")}
              </Text>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

export default SharedTrip;
