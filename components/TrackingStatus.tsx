import { Linking, Switch, Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import { type I18n, useI18n } from "@/lib/i18n";

import type { TrackingStatus as Status } from "@/lib/tracking";

const describe = (status: Status, t: I18n["t"]) => {
  switch (status.state) {
    case "off":
      return t("ride.tracking.off");
    case "starting":
      return t("ride.tracking.starting");
    case "denied":
      return t("ride.tracking.denied");
    case "services_off":
      return t("ride.tracking.servicesOff");
    case "unavailable":
      return t("ride.tracking.unavailable");
    case "tracking":
      if (status.lastProblem === "offline") return t("ride.tracking.offline");
      if (status.lastProblem === "weak_gps") {
        return t("ride.tracking.weakGps", {
          meters: Math.round(status.accuracy ?? 0),
        });
      }
      if (status.lastProblem === "rejected") return t("ride.tracking.rejected");
      return status.lastSentAt
        ? t("ride.tracking.sharingAgo", {
            seconds: Math.max(
              0,
              Math.round((Date.now() - status.lastSentAt) / 1000),
            ),
          })
        : t("ride.tracking.sharing");
  }
};

const TrackingStatus = ({
  status,
  wantBackground,
  onToggleBackground,
}: {
  status: Status;
  wantBackground: boolean;
  onToggleBackground: (value: boolean) => void;
}) => {
  const { t } = useI18n();
  const problem =
    status.state === "denied" ||
    status.state === "services_off" ||
    status.state === "unavailable" ||
    (status.state === "tracking" && status.lastProblem !== null);

  return (
    <View className="bg-white rounded-2xl p-5 mt-5">
      <Text className="text-lg font-JakartaBold" accessibilityRole="header">
        {t("ride.tracking.title")}
      </Text>
      <Text
        className={`text-sm mt-1 ${problem ? "text-orange-800" : "text-general-200"}`}
        accessibilityLiveRegion="polite"
      >
        {describe(status, t)}
      </Text>
      {(status.state === "denied" || status.state === "services_off") && (
        <CustomButton
          title={t("ride.tracking.openSettings")}
          bgVariant="outline"
          textVariant="primary"
          className="mt-3"
          onPress={() => Linking.openSettings()}
        />
      )}
      <View className="flex flex-row items-center justify-between mt-4">
        <View className="flex-1 pr-3">
          <Text className="text-base font-JakartaSemiBold">
            {t("ride.tracking.background")}
          </Text>
          <Text className="text-xs text-general-200 mt-1">
            {status.background === "unsupported"
              ? t("ride.tracking.backgroundUnsupported")
              : status.background === "denied"
                ? t("ride.tracking.backgroundDenied")
                : status.background === "on"
                  ? t("ride.tracking.backgroundOn")
                  : t("ride.tracking.backgroundOff")}
          </Text>
          <Text className="text-xs text-general-200 mt-1">
            {t("ride.tracking.forceQuit")}
          </Text>
        </View>
        <Switch
          value={wantBackground && status.background === "on"}
          disabled={status.background === "unsupported"}
          onValueChange={onToggleBackground}
          accessibilityLabel={t("ride.tracking.background")}
        />
      </View>
    </View>
  );
};

export default TrackingStatus;
