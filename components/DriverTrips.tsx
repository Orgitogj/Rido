import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { useApiQuery } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";

import type { DriverTrip } from "@/shared/contracts";

const DriverTrips = () => {
  const { t, queryError, money, dateTime } = useI18n();
  const trips = useApiQuery<DriverTrip[]>("/api/driver/trips", {
    refetchOnFocus: true,
  });
  const list = trips.data ?? [];
  return (
    <View className="bg-white rounded-2xl p-5 mt-5">
      <Text className="text-lg font-JakartaBold" accessibilityRole="header">
        {t("driver.trips.title")}
      </Text>
      {trips.status === "error" && (
        <Text className="text-sm text-red-600 mt-2">{queryError(trips)}</Text>
      )}
      {trips.status !== "loading" && list.length === 0 && (
        <Text className="text-sm text-general-200 mt-2">
          {t("driver.trips.empty")}
        </Text>
      )}
      {list.slice(0, 10).map((trip) => (
        <View
          key={trip.rideId}
          className="border-t border-general-700 py-3 mt-2"
        >
          <Text className="text-sm font-JakartaSemiBold" numberOfLines={1}>
            {trip.pickup.address} → {trip.destination.address}
          </Text>
          <Text className="text-xs text-general-200 mt-1">
            {trip.completedAt ? `${dateTime(trip.completedAt)} · ` : ""}
            {t("driver.trips.quotedFare", { amount: money(trip.fareCents) })}
          </Text>
          {trip.ratingPending && (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: "/(root)/ride/[id]",
                  params: { id: trip.rideId },
                })
              }
              className="mt-1 min-h-[44px] justify-center"
            >
              <Text className="text-sm text-[#0066CC] font-JakartaSemiBold">
                {t("driver.trips.ratePassenger")}
              </Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
};

export default DriverTrips;
