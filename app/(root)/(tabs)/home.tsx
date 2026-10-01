import { useUser } from "@clerk/expo";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect } from "react";
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
import { SavedPlaceChips } from "@/components/SavedPlaces";
import StatusBadge from "@/components/StatusBadge";
import { icons } from "@/constants";
import { useApiQuery } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
import { useInbox } from "@/lib/inbox";
import { useCurrentLocation } from "@/lib/location";
import { rideHeadline } from "@/lib/rideText";
import { useSignOut } from "@/lib/session";
import { useLocationStore } from "@/store";

import type { RideView } from "@/shared/contracts";

const Home = () => {
  const { t, tn, language, queryError } = useI18n();
  const { user } = useUser();
  const handleSignOut = useSignOut();
  const { unread, reload: reloadInbox } = useInbox();

  useFocusEffect(
    useCallback(() => {
      reloadInbox();
    }, [reloadInbox]),
  );

  const setDestinationLocation = useLocationStore(
    (s) => s.setDestinationLocation,
  );
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
            <ListState
              kind="loading"
              message={t("booking.home.loadingRides")}
            />
          ) : rides.status === "error" ? (
            <ListState
              kind="error"
              message={queryError(rides)}
              onRetry={refetch}
            />
          ) : (
            <ListState kind="empty" message={t("booking.home.noRecent")} />
          )
        }
        ListFooterComponent={
          recent.length > 0 ? (
            <CustomButton
              title={t("booking.home.seeAll")}
              bgVariant="outline"
              textVariant="primary"
              onPress={() => router.push("/(root)/(tabs)/rides")}
            />
          ) : null
        }
        ListHeaderComponent={
          <>
            <View className="flex flex-row items-center justify-between my-5">
              <Text
                className="text-2xl font-JakartaExtraBold flex-1"
                accessibilityRole="header"
                numberOfLines={1}
              >
                {user?.firstName
                  ? t("booking.home.welcome", { name: user.firstName })
                  : t("booking.home.welcomeNoName")}
              </Text>
              <TouchableOpacity
                onPress={() => router.push("/(root)/notifications")}
                accessibilityRole="button"
                accessibilityLabel={
                  unread > 0
                    ? tn("booking.home.unread", unread)
                    : t("booking.home.notifications")
                }
                className="justify-center items-center w-11 h-11 rounded-full bg-white mr-2"
              >
                <Text className="text-lg">🔔</Text>
                {unread > 0 && (
                  <View className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-600 items-center justify-center">
                    <Text className="text-[11px] text-white font-JakartaBold">
                      {unread > 99 ? "99+" : unread}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSignOut}
                accessibilityRole="button"
                accessibilityLabel={t("booking.home.signOut")}
                className="justify-center items-center w-11 h-11 rounded-full bg-white"
              >
                <Image source={icons.out} className="w-4 h-4" />
              </TouchableOpacity>
            </View>

            {activeRide && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`${t("booking.home.rideInProgress")}. ${rideHeadline(activeRide, language)}. ${t("booking.home.tapToOpen")}`}
                onPress={() =>
                  router.push({
                    pathname: "/(root)/ride/[id]",
                    params: { id: activeRide.id },
                  })
                }
                className="bg-[#0066CC] rounded-2xl p-4 mb-4"
              >
                <View className="flex flex-row items-center justify-between">
                  <Text className="text-white text-lg font-JakartaBold">
                    {t("booking.home.rideInProgress")}
                  </Text>
                  <StatusBadge status={activeRide.status} />
                </View>
                <Text className="text-white text-sm mt-1">
                  {rideHeadline(activeRide, language)} ·{" "}
                  {t("booking.home.tapToOpen")}
                </Text>
              </TouchableOpacity>
            )}

            <GoogleTextInput
              icon={icons.search}
              containerStyle="bg-white shadow-md shadow-neutral-300"
              handlePress={handleDestinationPress}
            />
            <SavedPlaceChips onSelect={handleDestinationPress} />

            {(locationStatus === "denied" ||
              locationStatus === "unavailable") && (
              <View className="bg-white rounded-xl p-4 mt-4">
                <Text className="text-sm font-JakartaMedium">
                  {locationStatus === "denied"
                    ? t("booking.home.locationDenied")
                    : t("booking.home.locationUnavailable")}
                </Text>
                <View className="flex flex-row mt-3 gap-x-3">
                  <CustomButton
                    title={t("common.retry")}
                    bgVariant="outline"
                    textVariant="primary"
                    className="flex-1 w-auto"
                    onPress={locate}
                  />
                  {locationStatus === "denied" && (
                    <CustomButton
                      title={t("booking.home.settings")}
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
                {t("booking.home.currentLocation")}
              </Text>
              <View className="flex flex-row items-center bg-transparent h-[300px]">
                <Map />
              </View>
            </>

            <CustomButton
              title={t("booking.home.drive")}
              bgVariant="outline"
              textVariant="primary"
              className="mt-5"
              onPress={() => router.push("/(root)/driver")}
            />

            <Text
              className="text-xl font-JakartaBold mt-5 mb-3"
              accessibilityRole="header"
            >
              {t("booking.home.recent")}
            </Text>
          </>
        }
      />
    </SafeAreaView>
  );
};

export default Home;
