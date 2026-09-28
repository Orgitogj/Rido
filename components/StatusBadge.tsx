import { Text, View } from "react-native";

import { type BadgeTone, STATUS_BADGE } from "@/lib/rideText";

import type { RideStatus } from "@/shared/contracts";

const TONE: Record<BadgeTone, string> = {
  success: "bg-green-100 text-green-700",
  neutral: "bg-neutral-200 text-neutral-700",
  active: "bg-blue-100 text-blue-700",
  warning: "bg-orange-100 text-orange-700",
};

const StatusBadge = ({ status }: { status: RideStatus }) => {
  const { label, tone } = STATUS_BADGE[status];
  const [bg, fg] = TONE[tone].split(" ");
  return (
    <View className={`rounded-full px-3 py-1 ${bg}`}>
      <Text className={`text-xs font-JakartaSemiBold ${fg}`}>{label}</Text>
    </View>
  );
};

export default StatusBadge;
