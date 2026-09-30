import { router, useLocalSearchParams } from "expo-router";
import { Text } from "react-native";

import ListState from "@/components/ListState";
import RideLayout from "@/components/RideLayout";
import RideMap from "@/components/RideMap";
import RideStatusPanel from "@/components/RideStatusPanel";
import { useRide } from "@/lib/rideUpdates";

const RideScreen = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rideId = String(id);
  const { ride, live, polyline, connection, error, perform } = useRide(rideId);

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace(
          ride?.viewer === "driver" ? "/(root)/driver" : "/(root)/(tabs)/home",
        );

  if (!ride) {
    return (
      <RideLayout title="Your ride" onBack={back}>
        {connection === "reconnecting" ? (
          <ListState
            kind="error"
            message={`${error ?? "Couldn't load this ride."} Retrying automatically.`}
            onRetry={() =>
              router.replace({
                pathname: "/(root)/ride/[id]",
                params: { id: rideId },
              })
            }
          />
        ) : (
          <ListState kind="loading" message="Loading your ride…" />
        )}
      </RideLayout>
    );
  }

  return (
    <RideLayout
      title={ride.viewer === "driver" ? "Current ride" : "Your ride"}
      snapPoints={["55%", "90%"]}
      onBack={back}
      map={
        <RideMap
          pickup={ride.pickup}
          destination={ride.destination}
          leg={live?.leg ?? null}
          driverLocation={live?.driverLocation ?? null}
          polyline={polyline}
        />
      }
    >
      <RideStatusPanel
        ride={ride}
        live={live}
        connection={connection}
        perform={perform}
      />
      <Text className="text-xs text-general-200">
        Ride {ride.id.slice(0, 8)}
      </Text>
    </RideLayout>
  );
};

export default RideScreen;
