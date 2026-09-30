import { Linking, Switch, Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";

import type { TrackingStatus as Status } from "@/lib/tracking";

const describe = (status: Status) => {
  switch (status.state) {
    case "off":
      return "Location sharing is off.";
    case "starting":
      return "Starting location sharing…";
    case "denied":
      return "Location permission is off, so riders can't see you and you won't get nearby requests.";
    case "services_off":
      return "Location services are turned off on this device.";
    case "unavailable":
      return "Your location isn't available right now.";
    case "tracking":
      if (status.lastProblem === "offline") {
        return "No connection: your position isn't reaching the server. Riders see your last update and its age.";
      }
      if (status.lastProblem === "weak_gps") {
        return `Weak GPS signal (±${Math.round(status.accuracy ?? 0)} m). Your position may be off.`;
      }
      if (status.lastProblem === "rejected") {
        return "Your last position couldn't be confirmed and wasn't shared.";
      }
      return status.lastSentAt
        ? `Sharing your location · last sent ${Math.max(0, Math.round((Date.now() - status.lastSentAt) / 1000))}s ago`
        : "Sharing your location";
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
  const problem =
    status.state === "denied" ||
    status.state === "services_off" ||
    status.state === "unavailable" ||
    (status.state === "tracking" && status.lastProblem !== null);

  return (
    <View className="bg-white rounded-2xl p-5 mt-5">
      <Text className="text-lg font-JakartaBold">Location</Text>
      <Text
        className={`text-sm mt-1 ${problem ? "text-orange-700" : "text-general-200"}`}
        accessibilityLiveRegion="polite"
      >
        {describe(status)}
      </Text>
      {(status.state === "denied" || status.state === "services_off") && (
        <CustomButton
          title="Open Settings"
          bgVariant="outline"
          textVariant="primary"
          className="mt-3"
          onPress={() => Linking.openSettings()}
        />
      )}
      <View className="flex flex-row items-center justify-between mt-4">
        <View className="flex-1 pr-3">
          <Text className="text-base font-JakartaSemiBold">
            Keep sharing in the background
          </Text>
          <Text className="text-xs text-general-200 mt-1">
            {status.background === "unsupported"
              ? "Not available in Expo Go. Keep this screen open, or use a development build."
              : status.background === "denied"
                ? 'Background location was not allowed. Enable "Allow all the time" in Settings.'
                : status.background === "on"
                  ? "On: a system notification shows while your location is shared."
                  : "Off: sharing pauses when you leave the app."}
          </Text>
        </View>
        <Switch
          value={wantBackground && status.background === "on"}
          disabled={status.background === "unsupported"}
          onValueChange={onToggleBackground}
          accessibilityLabel="Keep sharing location in the background"
        />
      </View>
    </View>
  );
};

export default TrackingStatus;
