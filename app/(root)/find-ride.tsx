import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import GoogleTextInput from "@/components/GoogleTextInput";
import RideLayout from "@/components/RideLayout";
import { SavedPlaceChips, SavePlacePrompt } from "@/components/SavedPlaces";
import { icons } from "@/constants";
import { useI18n } from "@/lib/i18n";
import { type TripProblemCode, tripProblemCode } from "@/shared/geo";
import { useLocationStore } from "@/store";

const FindRide = () => {
  const {
    userAddress,
    userLatitude,
    userLongitude,
    destinationAddress,
    destinationLatitude,
    destinationLongitude,
    setDestinationLocation,
    setUserLocation,
  } = useLocationStore();
  const { t } = useI18n();
  const [error, setError] = useState<TripProblemCode | null>(null);
  const [pickupPlaceId, setPickupPlaceId] = useState<string | null>(null);
  const [destinationPlaceId, setDestinationPlaceId] = useState<string | null>(
    null,
  );

  const findNow = () => {
    const problem = tripProblemCode(
      {
        latitude: userLatitude,
        longitude: userLongitude,
        address: userAddress,
      },
      {
        latitude: destinationLatitude,
        longitude: destinationLongitude,
        address: destinationAddress,
      },
    );
    setError(problem);
    if (!problem) router.push(`/(root)/confirm-ride`);
  };

  return (
    <RideLayout title={t("booking.find.title")}>
      <View className="my-3">
        <Text className="text-lg font-JakartaSemiBold mb-3">
          {t("booking.find.from")}
        </Text>

        <GoogleTextInput
          icon={icons.target}
          initialLocation={userAddress ?? t("booking.search.pickupPlaceholder")}
          containerStyle="bg-neutral-100"
          textInputBackgroundColor="#f5f5f5"
          handlePress={(location) => {
            setError(null);
            setPickupPlaceId(location.providerPlaceId ?? null);
            setUserLocation(location);
          }}
        />
        <SavedPlaceChips
          onSelect={(place) => {
            setError(null);
            setPickupPlaceId(place.providerPlaceId);
            setUserLocation(place);
          }}
        />
        <SavePlacePrompt
          place={{
            address: userAddress,
            latitude: userLatitude,
            longitude: userLongitude,
            providerPlaceId: pickupPlaceId,
          }}
        />
      </View>

      <View className="my-3">
        <Text className="text-lg font-JakartaSemiBold mb-3">
          {t("booking.find.to")}
        </Text>

        <GoogleTextInput
          icon={icons.map}
          initialLocation={destinationAddress}
          containerStyle="bg-neutral-100"
          textInputBackgroundColor="transparent"
          handlePress={(location) => {
            setError(null);
            setDestinationPlaceId(location.providerPlaceId ?? null);
            setDestinationLocation(location);
          }}
        />
        <SavedPlaceChips
          onSelect={(place) => {
            setError(null);
            setDestinationPlaceId(place.providerPlaceId);
            setDestinationLocation(place);
          }}
        />
        <SavePlacePrompt
          place={{
            address: destinationAddress,
            latitude: destinationLatitude,
            longitude: destinationLongitude,
            providerPlaceId: destinationPlaceId,
          }}
        />
      </View>

      {error && (
        <Text
          className="text-sm text-red-600 mt-2"
          accessibilityLiveRegion="polite"
        >
          {t(`booking.find.problem.${error}`)}
        </Text>
      )}

      <CustomButton
        title={t("booking.find.findNow")}
        onPress={findNow}
        className="mt-5"
      />
    </RideLayout>
  );
};

export default FindRide;
