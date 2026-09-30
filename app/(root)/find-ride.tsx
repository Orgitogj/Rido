import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import GoogleTextInput from "@/components/GoogleTextInput";
import RideLayout from "@/components/RideLayout";
import { icons } from "@/constants";
import { tripProblem } from "@/shared/geo";
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
  const [error, setError] = useState<string | null>(null);

  const findNow = () => {
    const problem = tripProblem(
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
    <RideLayout title="Ride">
      <View className="my-3">
        <Text className="text-lg font-JakartaSemiBold mb-3">From</Text>

        <GoogleTextInput
          icon={icons.target}
          initialLocation={userAddress ?? "Enter a pickup address"}
          containerStyle="bg-neutral-100"
          textInputBackgroundColor="#f5f5f5"
          handlePress={(location) => {
            setError(null);
            setUserLocation(location);
          }}
        />
      </View>

      <View className="my-3">
        <Text className="text-lg font-JakartaSemiBold mb-3">To</Text>

        <GoogleTextInput
          icon={icons.map}
          initialLocation={destinationAddress}
          containerStyle="bg-neutral-100"
          textInputBackgroundColor="transparent"
          handlePress={(location) => {
            setError(null);
            setDestinationLocation(location);
          }}
        />
      </View>

      {error && (
        <Text
          className="text-sm text-red-500 mt-2"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}

      <CustomButton title="Find Now" onPress={findNow} className="mt-5" />
    </RideLayout>
  );
};

export default FindRide;
