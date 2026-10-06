import { router } from "expo-router";
import { Image, Text, TouchableOpacity, View } from "react-native";

import StatusBadge from "@/components/StatusBadge";
import { icons } from "@/constants";
import { useI18n } from "@/lib/i18n";
import { isTerminal } from "@/lib/rideText";

import type { RideView } from "@/shared/contracts";

const geoapifyKey = process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY;

const RideCard = ({ ride }: { ride: RideView }) => {
  const { t, tn, money, dateTime } = useI18n();
  const who =
    ride.driver?.name ??
    (ride.legacyDemoDriver
      ? t("booking.history.simulated", { name: ride.legacyDemoDriver })
      : null);
  const charged = ride.paymentStatus === "paid";
  const paymentTag =
    ride.status === "legacy"
      ? ""
      : ride.paymentStatus === "cancelled" || ride.paymentStatus === "expired"
        ? ` (${t("ride.payment.notCharged")})`
        : ride.paymentStatus === "authorized"
          ? ` (${t("ride.payment.cardHold")})`
          : "";

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
      accessibilityLabel={t("booking.history.rideTo", {
        destination: ride.destination.address,
      })}
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
              accessible={false}
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
              <Text
                className="text-md font-JakartaMedium flex-1"
                numberOfLines={1}
              >
                {ride.pickup.address}
              </Text>
            </View>

            <View className="flex flex-row items-center gap-x-2">
              <Image source={icons.point} className="w-5 h-5" />
              <Text
                className="text-md font-JakartaMedium flex-1"
                numberOfLines={1}
              >
                {ride.destination.address}
              </Text>
            </View>
            {(ride.category || ride.stops.length > 0) && (
              <Text className="text-xs text-general-200">
                {[
                  ride.category?.name,
                  ride.category
                    ? tn("ride.offer.passengers", ride.passengerCount)
                    : null,
                  ride.stops.length > 0
                    ? tn("ride.offer.stops", ride.stops.length)
                    : null,
                  ride.scheduledRideId ? t("pay.receipt.fromSchedule") : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            )}
          </View>
        </View>

        <View className="flex flex-col w-full mt-5 bg-general-500 rounded-lg p-3 items-start justify-center">
          <View className="flex flex-row items-center w-full justify-between mb-5">
            <Text className="text-md font-JakartaMedium text-gray-600">
              {t("booking.history.status")}
            </Text>
            <StatusBadge status={ride.status} />
          </View>

          <View className="flex flex-row items-center w-full justify-between mb-5">
            <Text className="text-md font-JakartaMedium text-gray-600">
              {t("booking.history.requested")}
            </Text>
            <Text className="text-md font-JakartaBold" numberOfLines={1}>
              {dateTime(ride.requestedAt ?? ride.createdAt)}
            </Text>
          </View>

          {who && (
            <View className="flex flex-row items-center w-full justify-between mb-5">
              <Text className="text-md font-JakartaMedium text-gray-600">
                {t("booking.history.driver")}
              </Text>
              <Text className="text-md font-JakartaBold">{who}</Text>
            </View>
          )}

          <View className="flex flex-row items-center w-full justify-between">
            <Text className="text-md font-JakartaMedium text-gray-600">
              {charged
                ? t("booking.history.charged")
                : t("booking.history.fare")}
            </Text>
            <Text className="text-md font-JakartaBold">
              {money(ride.fareCents, ride.currency)}
              {paymentTag}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

export default RideCard;
