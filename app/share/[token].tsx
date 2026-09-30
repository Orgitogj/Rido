import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ListState from "@/components/ListState";
import { ApiRequestError, apiRequest } from "@/lib/fetch";
import { SHARED_TRIP_TEXT } from "@/lib/safetyText";

import type { SharedTripView } from "@/shared/contracts";

const REFRESH_MS = 15_000;

const SharedTrip = () => {
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
        <Text className="text-2xl font-JakartaExtraBold">Shared trip</Text>
        <Text className="text-xs text-general-200 mt-1">
          Someone shared their trip status with you. This page updates
          automatically and stops when they end sharing or the trip is over.
        </Text>

        {state === "loading" && (
          <ListState kind="loading" message="Loading trip…" />
        )}
        {state === "ended" && (
          <ListState
            kind="empty"
            message="This trip link has ended or doesn't exist."
          />
        )}
        {state === "error" && (
          <ListState
            kind="error"
            message={error ?? "Couldn't load the trip."}
            onRetry={load}
          />
        )}

        {trip && state === "ready" && (
          <View className="bg-white rounded-2xl p-5 mt-4">
            <Text
              className="text-xl font-JakartaBold"
              accessibilityLiveRegion="polite"
            >
              {SHARED_TRIP_TEXT[trip.status]}
            </Text>
            {trip.driver && (
              <Text className="text-sm mt-2">
                {trip.driver.firstName} · {trip.driver.vehicle} ·{" "}
                {trip.driver.plate}
              </Text>
            )}
            {trip.destination && (
              <Text className="text-sm text-general-200 mt-2">
                Heading to {trip.destination}
              </Text>
            )}
            {trip.driverLocation ? (
              <Pressable
                accessibilityRole="link"
                onPress={() =>
                  Linking.openURL(
                    `https://www.google.com/maps/search/?api=1&query=${trip.driverLocation!.latitude},${trip.driverLocation!.longitude}`,
                  ).catch(() => undefined)
                }
              >
                <Text className="text-sm text-[#0286FF] mt-3">
                  Driver&apos;s approximate position (
                  {trip.driverLocation.freshness === "live"
                    ? "live"
                    : "a few minutes ago"}
                  ) · open in Maps
                </Text>
              </Pressable>
            ) : (
              <Text className="text-xs text-general-200 mt-3">
                Driver position isn&apos;t shown right now.
              </Text>
            )}
            {error && (
              <Text className="text-xs text-orange-700 mt-3">
                Couldn&apos;t refresh just now. Showing the last update.
              </Text>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

export default SharedTrip;
