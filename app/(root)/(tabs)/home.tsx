import { useAuth, useUser } from "@clerk/expo";
import { router } from "expo-router";
import { useEffect } from "react";
import {
  FlatList,
  Image,
  Linking,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import GoogleTextInput from "@/components/GoogleTextInput";
import ListState from "@/components/ListState";
import Map from "@/components/Map";
import RideCard from "@/components/RideCard";
import StatusBadge from "@/components/StatusBadge";
import { icons } from "@/constants";
import { useApiQuery } from "@/lib/fetch";
import { useApi } from "@/lib/fetch";
import { useCurrentLocation } from "@/lib/location";
import { unregisterPush } from "@/lib/notifications";
import { rideHeadline } from "@/lib/rideText";
import { stopBackgroundTracking } from "@/lib/tracking";
import { useLocationStore, useRideStore } from "@/store";

import type { RideView } from "@/shared/contracts";

const Home = () => {
  const { user } = useUser();
  const { signOut } = useAuth();
  const request = useApi();

  const setDestinationLocation = useLocationStore(
    (s) => s.setDestinationLocation,
  );
  const resetLocation = useLocationStore((s) => s.reset);
  const clearRide = useRideStore((s) => s.clear);
  const { locationStatus, locate } = useCurrentLocation();

  const rides = useApiQuery<RideView[]>("/api/rides", {
    refetchOnFocus: true,
  });
  const active = useApiQuery<RideView | null>("/api/rides/active", {
    refetchOnFocus: true,
  });
  const activeRide = active.data;
  const { refetch } = rides;

  useEffect(() => {
    if (locationStatus === "idle") locate();
  }, [locationStatus, locate]);

  const handleSignOut = async () => {
    clearRide();
    resetLocation();
    await stopBackgroundTracking();
    await unregisterPush(request);
    await signOut();
    router.replace("/(auth)/sign-in");
  };

  const handleDestinationPress = (location: {
    latitude: number;
    longitude: number;
    address: string;
  }) => {
    setDestinationLocation(location);
    router.push("/(root)/find-ride");
  };

  const recent = rides.data?.slice(0, 5) ?? [];

  return (
    <SafeAreaView className="bg-general-500">
      <FlatList
        data={recent}
        renderItem={({ item }) => <RideCard ride={item} />}
        keyExtractor={(item) => item.id}
        className="px-5"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingBottom: 100,
        }}
        ListEmptyComponent={
          rides.status === "loading" ? (
            <ListState kind="loading" message="Loading your rides…" />
          ) : rides.status === "error" ? (
            <ListState kind="error" message={rides.error} onRetry={refetch} />
          ) : (
            <ListState kind="empty" message="No recent rides found" />
          )
        }
        ListHeaderComponent={
          <>
            <View className="flex flex-row items-center justify-between my-5">
              <Text className="text-2xl font-JakartaExtraBold">
                Welcome {user?.firstName}
              </Text>
              <TouchableOpacity
                onPress={handleSignOut}
                accessibilityRole="button"
                accessibilityLabel="Sign out"
                className="justify-center items-center w-10 h-10 rounded-full bg-white"
              >
                <Image source={icons.out} className="w-4 h-4" />
              </TouchableOpacity>
            </View>

            {activeRide && (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: "/(root)/ride/[id]",
                    params: { id: activeRide.id },
                  })
                }
                className="bg-[#0286FF] rounded-2xl p-4 mb-4"
              >
                <View className="flex flex-row items-center justify-between">
                  <Text className="text-white text-lg font-JakartaBold">
                    Ride in progress
                  </Text>
                  <StatusBadge status={activeRide.status} />
                </View>
                <Text className="text-white text-sm mt-1">
                  {rideHeadline(activeRide)} · Tap to open
                </Text>
              </TouchableOpacity>
            )}

            <GoogleTextInput
              icon={icons.search}
              containerStyle="bg-white shadow-md shadow-neutral-300"
              handlePress={handleDestinationPress}
            />

            {(locationStatus === "denied" ||
              locationStatus === "unavailable") && (
              <View className="bg-white rounded-xl p-4 mt-4">
                <Text className="text-sm font-JakartaMedium">
                  {locationStatus === "denied"
                    ? "Location permission is off. You can still book by entering a pickup address on the next screen."
                    : "We couldn't get your location. You can retry or enter a pickup address on the next screen."}
                </Text>
                <View className="flex flex-row mt-3 gap-x-3">
                  <CustomButton
                    title="Retry"
                    bgVariant="outline"
                    textVariant="primary"
                    className="flex-1 w-auto"
                    onPress={locate}
                  />
                  {locationStatus === "denied" && (
                    <CustomButton
                      title="Settings"
                      bgVariant="outline"
                      textVariant="primary"
                      className="flex-1 w-auto"
                      onPress={() => Linking.openSettings()}
                    />
                  )}
                </View>
              </View>
            )}

            <>
              <Text className="text-xl font-JakartaBold mt-5 mb-3">
                Your current location
              </Text>
              <View className="flex flex-row items-center bg-transparent h-[300px]">
                <Map />
              </View>
            </>

            <CustomButton
              title="Drive with us"
              bgVariant="outline"
              textVariant="primary"
              className="mt-5"
              onPress={() => router.push("/(root)/driver")}
            />

            <Text className="text-xl font-JakartaBold mt-5 mb-3">
              Recent Rides
            </Text>
          </>
        }
      />
    </SafeAreaView>
  );
};

export default Home;
