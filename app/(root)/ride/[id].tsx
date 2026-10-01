import { router, useLocalSearchParams } from "expo-router";
import { Text } from "react-native";

import ListState from "@/components/ListState";
import RideLayout from "@/components/RideLayout";
import RideMap from "@/components/RideMap";
import RideStatusPanel from "@/components/RideStatusPanel";
import { useI18n } from "@/lib/i18n";
import { useRide } from "@/lib/rideUpdates";

const RideScreen = () => {
  const { t, language } = useI18n();
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
      <RideLayout title={t("ride.panel.title")} onBack={back}>
        {connection === "reconnecting" ? (
          <ListState
            kind="error"
            message={`${language === "en" && error ? error : t("ride.panel.loadFailed")} ${t("ride.panel.retrying")}`}
            onRetry={() =>
              router.replace({
                pathname: "/(root)/ride/[id]",
                params: { id: rideId },
              })
            }
          />
        ) : (
          <ListState kind="loading" message={t("ride.panel.loading")} />
        )}
      </RideLayout>
    );
  }

  return (
    <RideLayout
      title={
        ride.viewer === "driver"
          ? t("ride.panel.titleDriver")
          : t("ride.panel.title")
      }
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
      <Text className="text-xs text-general-200" selectable>
        {t("ride.panel.rideId", { id: ride.id.slice(0, 8) })}
      </Text>
    </RideLayout>
  );
};

export default RideScreen;
