import { router } from "expo-router";
import { Image, Text, TouchableOpacity, View } from "react-native";

import StatusBadge from "@/components/StatusBadge";
import { icons } from "@/constants";
import { isTerminal } from "@/lib/rideText";
import { formatCents, formatDate } from "@/lib/utils";

import type { RideView } from "@/shared/contracts";

const geoapifyKey = process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY;

const RideCard = ({ ride }: { ride: RideView }) => {
  const who =
    ride.driver?.name ??
    (ride.legacyDemoDriver ? `${ride.legacyDemoDriver} (simulated)` : null);
  const charged = ride.paymentStatus === "paid";

  return (
    <TouchableOpacity
      onPress={() =>
        router.push({
          pathname: isTerminal(ride.status)
            ? "/(root)/receipt/[id]"
            : "/(root)/ride/[id]",
          params: { id: ride.id },
        })
      }
      accessibilityRole="button"
      accessibilityLabel={`Ride to ${ride.destination.address}`}
      className="flex flex-row items-center justify-center bg-white rounded-lg shadow-sm shadow-neutral-300 mb-3"
    >
      <View className="flex flex-col items-start justify-center p-3 w-full">
        <View className="flex flex-row items-center justify-between">
          {geoapifyKey ? (
            <Image
              source={{
                uri: `https://maps.geoapify.com/v1/staticmap?style=osm-bright&width=600&height=400&center=lonlat:${ride.destination.longitude},${ride.destination.latitude}&zoom=14&apiKey=${geoapifyKey}`,
              }}
              className="w-[80px] h-[90px] rounded-lg"
            />
          ) : (
            <View className="w-[80px] h-[90px] rounded-lg bg-general-500 items-center justify-center">
              <Image
                source={icons.map}
                className="w-8 h-8"
                resizeMode="contain"
              />
            </View>
          )}
          <View className="flex flex-col mx-5 gap-y-5 flex-1">
            <View className="flex flex-row items-center gap-x-2">
              <Image source={icons.to} className="w-5 h-5" />
              <Text className="text-md font-JakartaMedium" numberOfLines={1}>
                {ride.pickup.address}
              </Text>
            </View>

            <View className="flex flex-row items-center gap-x-2">
              <Image source={icons.point} className="w-5 h-5" />
              <Text className="text-md font-JakartaMedium" numberOfLines={1}>
                {ride.destination.address}
              </Text>
            </View>
          </View>
        </View>

        <View className="flex flex-col w-full mt-5 bg-general-500 rounded-lg p-3 items-start justify-center">
          <View className="flex flex-row items-center w-full justify-between mb-5">
            <Text className="text-md font-JakartaMedium text-gray-500">
              Status
            </Text>
            <StatusBadge status={ride.status} />
          </View>

          <View className="flex flex-row items-center w-full justify-between mb-5">
            <Text className="text-md font-JakartaMedium text-gray-500">
              Requested
            </Text>
            <Text className="text-md font-JakartaBold" numberOfLines={1}>
              {formatDate(ride.requestedAt ?? ride.createdAt)}
            </Text>
          </View>

          {who && (
            <View className="flex flex-row items-center w-full justify-between mb-5">
              <Text className="text-md font-JakartaMedium text-gray-500">
                Driver
              </Text>
              <Text className="text-md font-JakartaBold">{who}</Text>
            </View>
          )}

          <View className="flex flex-row items-center w-full justify-between">
            <Text className="text-md font-JakartaMedium text-gray-500">
              {charged ? "Charged" : "Fare"}
            </Text>
            <Text className="text-md font-JakartaBold">
              {formatCents(ride.fareCents)}
              {ride.status === "legacy"
                ? ""
                : ride.paymentStatus === "cancelled" ||
                    ride.paymentStatus === "expired"
                  ? " (not charged)"
                  : ride.paymentStatus === "authorized"
                    ? " (card hold)"
                    : ""}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

export default RideCard;
