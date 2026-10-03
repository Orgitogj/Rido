import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import GoogleTextInput from "@/components/GoogleTextInput";
import RideLayout from "@/components/RideLayout";
import { SavedPlaceChips, SavePlacePrompt } from "@/components/SavedPlaces";
import StopsEditor from "@/components/StopsEditor";
import VehicleOptions from "@/components/VehicleOptions";
import { icons } from "@/constants";
import { useI18n } from "@/lib/i18n";
import { repeatedPlace } from "@/lib/itinerary";
import { type TripProblemCode, tripProblemCode } from "@/shared/geo";
import { useLocationStore, useRideStore } from "@/store";

const FindRide = () => {
  const {
    userAddress,
    userLatitude,
    userLongitude,
    destinationAddress,
    destinationLatitude,
    destinationLongitude,
    stops,
    setDestinationLocation,
    setUserLocation,
  } = useLocationStore();
  const setScheduledRide = useRideStore((s) => s.setScheduledRide);
  const { t } = useI18n();
  const [error, setError] = useState<TripProblemCode | "STOP" | null>(null);
  const [pickupPlaceId, setPickupPlaceId] = useState<string | null>(null);
  const [destinationPlaceId, setDestinationPlaceId] = useState<string | null>(
    null,
  );

  const check = () => {
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
    if (problem && !(problem === "TOO_CLOSE" && stops.length > 0)) {
      setError(problem);
      return false;
    }
    if (
      userLatitude !== null &&
      userLongitude !== null &&
      destinationLatitude !== null &&
      destinationLongitude !== null &&
      repeatedPlace([
        { latitude: userLatitude, longitude: userLongitude },
        ...stops,
        { latitude: destinationLatitude, longitude: destinationLongitude },
      ])
    ) {
      setError("STOP");
      return false;
    }
    setError(null);
    return true;
  };

  const findNow = () => {
    if (!check()) return;
    setScheduledRide(null);
    router.push(`/(root)/confirm-ride`);
  };

  const scheduleLater = () => {
    if (!check()) return;
    setScheduledRide(null);
    router.push("/(root)/schedule-ride");
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

      <StopsEditor />
      <VehicleOptions />

      {error && (
        <Text
          className="text-sm text-red-600 mt-2"
          accessibilityLiveRegion="polite"
        >
          {error === "STOP"
            ? t("booking.find.stopProblem")
            : t(`booking.find.problem.${error}`)}
        </Text>
      )}

      <CustomButton
        title={t("booking.find.findNow")}
        onPress={findNow}
        className="mt-5"
      />
      <CustomButton
        title={t("schedule.scheduleLater")}
        bgVariant="outline"
        textVariant="primary"
        onPress={scheduleLater}
        className="mt-3 mb-10"
      />
    </RideLayout>
  );
};

export default FindRide;
