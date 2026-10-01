import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import { icons } from "@/constants";
import { useI18n } from "@/lib/i18n";
import { formatRating } from "@/lib/ratingText";

import type { RideOfferView } from "@/shared/contracts";

const OfferCard = ({
  offer,
  receivedAt,
  busy,
  onAccept,
  onDecline,
}: {
  offer: RideOfferView;
  receivedAt: number;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) => {
  const { t, language, money, km } = useI18n();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(
    0,
    offer.expiresInSeconds - Math.floor((now - receivedAt) / 1000),
  );

  return (
    <View className="bg-white rounded-2xl p-5 shadow-md shadow-neutral-300 mt-5">
      <View className="flex flex-row items-center justify-between">
        <Text className="text-xl font-JakartaBold" accessibilityRole="header">
          {t("ride.offer.title")}
        </Text>
        <Text
          className={`text-base font-JakartaBold ${left <= 5 ? "text-red-600" : "text-general-200"}`}
        >
          {t("ride.offer.seconds", { seconds: left })}
        </Text>
      </View>
      <Text className="text-2xl font-JakartaExtraBold text-green-700 mt-2">
        {money(offer.fareCents)}
      </Text>
      <Text className="text-sm text-general-200 mt-1">
        {t("ride.offer.distance", {
          pickup: km(offer.distanceToPickupMeters),
          trip:
            offer.tripDistanceMeters === null
              ? "--"
              : km(offer.tripDistanceMeters),
        })}
      </Text>
      <Text className="text-sm text-general-200 mt-1">
        {t("ride.offer.passengerRating", {
          rating: formatRating(offer.passengerRating, language),
        })}
      </Text>

      <View className="flex flex-row items-center mt-4">
        <Image source={icons.to} className="w-5 h-5" />
        <Text className="text-base font-Jakarta ml-2 flex-1">
          {offer.pickup.address}
        </Text>
      </View>
      <View className="flex flex-row items-center mt-3">
        <Image source={icons.point} className="w-5 h-5" />
        <Text className="text-base font-Jakarta ml-2 flex-1">
          {offer.destination.address}
        </Text>
      </View>

      {left === 0 && (
        <Text
          className="text-sm text-general-200 mt-3"
          accessibilityLiveRegion="polite"
        >
          {t("ride.offer.expired")}
        </Text>
      )}

      <View className="flex flex-row mt-5 gap-x-3">
        <CustomButton
          title={t("ride.offer.decline")}
          bgVariant="outline"
          textVariant="primary"
          className="flex-1 w-auto"
          disabled={busy || left === 0}
          onPress={onDecline}
        />
        <CustomButton
          title={busy ? "…" : t("ride.offer.accept")}
          bgVariant="success"
          className="flex-1 w-auto"
          disabled={busy || left === 0}
          onPress={onAccept}
        />
      </View>
    </View>
  );
};

export default OfferCard;
