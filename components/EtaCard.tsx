import { Text, View } from "react-native";

import { formatClock, formatTime } from "@/lib/utils";

import type { LiveTripView } from "@/shared/contracts";

const EtaCard = ({
  live,
  viewer,
}: {
  live: LiveTripView;
  viewer: "passenger" | "driver";
}) => {
  if (!live.leg) return null;
  const { eta } = live;
  const toPickup = live.leg === "pickup";

  return (
    <View className="bg-blue-50 rounded-2xl px-4 py-3 mt-4">
      {eta ? (
        <>
          <Text className="text-xs font-JakartaSemiBold text-blue-700">
            {toPickup
              ? viewer === "driver"
                ? "Estimated arrival at pickup"
                : "Estimated pickup"
              : "Estimated arrival at destination"}
          </Text>
          <Text className="text-2xl font-JakartaBold mt-1">
            {formatClock(eta.arrivalAt)}
            <Text className="text-base font-Jakarta text-general-200">
              {"  "}about {formatTime(eta.durationSeconds / 60)}
            </Text>
          </Text>
          <Text className="text-xs text-general-200 mt-1">
            {eta.source === "routed"
              ? "Estimated from the driving route. Not a guaranteed time; it updates as the driver moves."
              : "Rough straight-line estimate (route unavailable). Not a guaranteed time."}
          </Text>
        </>
      ) : (
        <Text className="text-sm text-general-200">
          {live.leg === "destination" && live.locationStatus !== "unavailable"
            ? "Arrival estimate will appear once the trip starts."
            : "Arrival estimate unavailable: the driver's location hasn't been updated recently."}
        </Text>
      )}
      <Text className="text-xs text-general-200 mt-1">
        Your fare is fixed at the quoted price and doesn't change with the ETA.
      </Text>
    </View>
  );
};

export default EtaCard;
