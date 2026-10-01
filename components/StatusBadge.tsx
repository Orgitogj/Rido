import { Text, View } from "react-native";

import { useI18n } from "@/lib/i18n";
import { type BadgeTone, statusLabel, statusTone } from "@/lib/rideText";

import type { RideStatus } from "@/shared/contracts";

const TONE: Record<BadgeTone, string> = {
  success: "bg-green-100 text-green-800",
  neutral: "bg-neutral-200 text-neutral-800",
  active: "bg-blue-100 text-blue-800",
  warning: "bg-orange-100 text-orange-800",
};

const StatusBadge = ({ status }: { status: RideStatus }) => {
  const { language } = useI18n();
  const [bg, fg] = TONE[statusTone(status)].split(" ");
  return (
    <View className={`rounded-full px-3 py-1 ${bg}`}>
      <Text className={`text-xs font-JakartaSemiBold ${fg}`}>
        {statusLabel(status, language)}
      </Text>
    </View>
  );
};

export default StatusBadge;
