import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { useApiQuery } from "@/lib/fetch";
import { formatCents, formatDate } from "@/lib/utils";

import type { DriverTrip } from "@/shared/contracts";

const DriverTrips = () => {
  const trips = useApiQuery<DriverTrip[]>("/api/driver/trips", {
    refetchOnFocus: true,
  });
  const list = trips.data ?? [];
  return (
    <View className="bg-white rounded-2xl p-5 mt-5">
      <Text className="text-lg font-JakartaBold">Recent trips</Text>
      {trips.status === "error" && (
        <Text className="text-sm text-red-500 mt-2">{trips.error}</Text>
      )}
      {trips.status !== "loading" && list.length === 0 && (
        <Text className="text-sm text-general-200 mt-2">
          Completed trips will appear here.
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
            {trip.completedAt ? formatDate(trip.completedAt) : ""} · quoted fare{" "}
            {formatCents(trip.fareCents)}
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
              className="mt-2"
            >
              <Text className="text-sm text-[#0286FF]">Rate passenger</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
};

export default DriverTrips;
