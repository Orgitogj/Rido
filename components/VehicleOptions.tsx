import { useEffect } from "react";
import { Pressable, Text, TouchableOpacity, View } from "react-native";

import { useApiQuery } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
import { useLocationStore, useRideStore } from "@/store";

import type { CategoryAvailability } from "@/shared/vehicleCategory";

const VehicleOptions = () => {
  const { t, tn, queryError } = useI18n();
  const { userLatitude, userLongitude } = useLocationStore();
  const { categoryId, passengerCount, setCategory, setPassengerCount } =
    useRideStore();
  const hasPickup = userLatitude !== null && userLongitude !== null;
  const query = useApiQuery<CategoryAvailability>(
    hasPickup
      ? `/api/categories?latitude=${userLatitude}&longitude=${userLongitude}&passengers=${passengerCount}`
      : null,
  );
  const loaded = query.status === "success" ? query.data.categories : null;
  const options = query.data?.categories ?? [];
  const selected = options.find((c) => c.id === categoryId) ?? null;

  useEffect(() => {
    if (!loaded) return;
    if (loaded.length === 0) {
      if (categoryId !== null) setCategory(null);
    } else if (!loaded.some((c) => c.id === categoryId)) {
      setCategory(loaded[0].id);
    }
  }, [loaded, categoryId, setCategory]);

  return (
    <View className="my-3">
      <Text className="text-lg font-JakartaSemiBold">
        {t("booking.vehicle.title")}
      </Text>

      <View className="flex flex-row items-center justify-between mt-2">
        <Text className="text-base flex-1">
          {t("booking.vehicle.passengers")}
        </Text>
        <TouchableOpacity
          onPress={() => setPassengerCount(passengerCount - 1)}
          disabled={passengerCount <= 1}
          accessibilityRole="button"
          accessibilityLabel={t("booking.vehicle.fewer")}
          className={`w-11 h-11 rounded-full bg-neutral-100 items-center justify-center ${passengerCount <= 1 ? "opacity-30" : ""}`}
        >
          <Text className="text-xl">−</Text>
        </TouchableOpacity>
        <Text
          className="text-lg font-JakartaBold w-10 text-center"
          accessibilityLiveRegion="polite"
          accessibilityLabel={tn("schedule.passengers", passengerCount)}
        >
          {passengerCount}
        </Text>
        <TouchableOpacity
          onPress={() => setPassengerCount(passengerCount + 1)}
          disabled={passengerCount >= 8}
          accessibilityRole="button"
          accessibilityLabel={t("booking.vehicle.more")}
          className={`w-11 h-11 rounded-full bg-neutral-100 items-center justify-center ${passengerCount >= 8 ? "opacity-30" : ""}`}
        >
          <Text className="text-xl">+</Text>
        </TouchableOpacity>
      </View>

      {!hasPickup && (
        <Text className="text-sm text-general-200 mt-2">
          {t("booking.vehicle.choosePickup")}
        </Text>
      )}
      {hasPickup && query.status === "loading" && !query.data && (
        <Text className="text-sm text-general-200 mt-2">
          {t("common.loading")}
        </Text>
      )}
      {hasPickup && query.status === "error" && (
        <View className="mt-2">
          <Text
            className="text-sm text-red-600"
            accessibilityLiveRegion="polite"
          >
            {queryError(query)}
          </Text>
          <TouchableOpacity
            onPress={query.refetch}
            accessibilityRole="button"
            className="min-h-[44px] justify-center"
          >
            <Text className="text-sm text-[#0066CC] font-JakartaSemiBold">
              {t("common.retry")}
            </Text>
          </TouchableOpacity>
        </View>
      )}
      {hasPickup && query.status === "success" && options.length === 0 && (
        <Text
          className="text-sm text-general-200 mt-2"
          accessibilityLiveRegion="polite"
        >
          {passengerCount > 1
            ? t("booking.vehicle.noneForCount")
            : t("booking.vehicle.none")}
        </Text>
      )}

      <View accessibilityRole="radiogroup">
        {options.map((option) => {
          const active = option.id === selected?.id;
          return (
            <Pressable
              key={option.id}
              onPress={() => setCategory(option.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              className={`rounded-xl p-3 mt-2 border ${active ? "border-[#0066CC] bg-[#E6F3FF]" : "border-neutral-300 bg-white"}`}
            >
              <View className="flex flex-row justify-between">
                <Text className="text-base font-JakartaSemiBold flex-1">
                  {option.name}
                </Text>
                <Text className="text-sm text-general-200 ml-2">
                  {t("booking.vehicle.upTo", { count: option.capacity })}
                </Text>
              </View>
              {option.isDevelopment && (
                <Text className="text-xs text-orange-800 mt-1">
                  {t("booking.vehicle.development")}
                </Text>
              )}
              {option.description !== "" && (
                <Text className="text-xs text-general-200 mt-1">
                  {option.description}
                </Text>
              )}
              <Text className="text-xs text-neutral-700 mt-1">
                {option.driversNearby > 0
                  ? tn("booking.vehicle.nearby", option.driversNearby)
                  : t("booking.vehicle.noneNearby")}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {options.length > 0 && (
        <Text className="text-xs text-general-200 mt-2">
          {t("booking.vehicle.estimate")}
        </Text>
      )}
    </View>
  );
};

export default VehicleOptions;
