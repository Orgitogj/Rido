import { Text, View } from "react-native";

import { useI18n } from "@/lib/i18n";

import type { LiveTripView } from "@/shared/contracts";

const EtaCard = ({
  live,
  viewer,
}: {
  live: LiveTripView;
  viewer: "passenger" | "driver";
}) => {
  const { t, clock, duration } = useI18n();
  if (!live.leg) return null;
  const { eta } = live;
  const toPickup = live.leg === "pickup";

  return (
    <View className="bg-blue-50 rounded-2xl px-4 py-3 mt-4">
      {eta ? (
        <>
          <Text className="text-xs font-JakartaSemiBold text-blue-800">
            {toPickup
              ? viewer === "driver"
                ? t("ride.eta.pickupDriver")
                : t("ride.eta.pickupPassenger")
              : t("ride.eta.destination")}
          </Text>
          <Text className="text-2xl font-JakartaBold mt-1">
            {clock(eta.arrivalAt)}
            <Text className="text-base font-Jakarta text-general-200">
              {"  "}
              {t("ride.eta.about", {
                duration: duration(eta.durationSeconds / 60),
              })}
            </Text>
          </Text>
          <Text className="text-xs text-general-200 mt-1">
            {eta.source === "routed"
              ? t("ride.eta.routed")
              : t("ride.eta.rough")}
          </Text>
        </>
      ) : (
        <Text className="text-sm text-general-200">
          {live.leg === "destination" && live.locationStatus !== "unavailable"
            ? t("ride.eta.afterStart")
            : t("ride.eta.unavailable")}
        </Text>
      )}
      {viewer === "passenger" && (
        <Text className="text-xs text-general-200 mt-1">
          {t("ride.eta.fixedFare")}
        </Text>
      )}
    </View>
  );
};

export default EtaCard;
