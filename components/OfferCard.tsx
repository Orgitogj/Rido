import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import { icons } from "@/constants";
import { formatRating } from "@/lib/ratingText";
import { formatCents } from "@/lib/utils";

import type { RideOfferView } from "@/shared/contracts";

const km = (m: number | null) =>
  m === null ? "--" : `${(m / 1000).toFixed(1)} km`;

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
        <Text className="text-xl font-JakartaBold">New ride request</Text>
        <Text
          className={`text-base font-JakartaBold ${left <= 5 ? "text-red-500" : "text-general-200"}`}
          accessibilityLiveRegion="polite"
        >
          {left}s
        </Text>
      </View>
      <Text className="text-2xl font-JakartaExtraBold text-[#0CC25F] mt-2">
        {formatCents(offer.fareCents)}
      </Text>
      <Text className="text-sm text-general-200 mt-1">
        Pickup about {km(offer.distanceToPickupMeters)} away (straight line) ·
        trip {km(offer.tripDistanceMeters)}
      </Text>
      <Text className="text-sm text-general-200 mt-1">
        Passenger rating: {formatRating(offer.passengerRating)}
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

      <View className="flex flex-row mt-5 gap-x-3">
        <CustomButton
          title="Decline"
          bgVariant="outline"
          textVariant="primary"
          className="flex-1 w-auto"
          disabled={busy || left === 0}
          onPress={onDecline}
        />
        <CustomButton
          title={busy ? "…" : "Accept"}
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
