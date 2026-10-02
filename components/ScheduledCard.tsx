import { Text, View } from "react-native";

import { useI18n } from "@/lib/i18n";

import type { ScheduledRideView, ScheduledState } from "@/shared/schedule";

const TONE: Record<ScheduledState, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  awaiting_confirmation: "bg-orange-100 text-orange-800",
  searching: "bg-blue-100 text-blue-800",
  fulfilled: "bg-green-100 text-green-800",
  no_driver: "bg-neutral-200 text-neutral-800",
  cancelled: "bg-neutral-200 text-neutral-800",
  expired: "bg-neutral-200 text-neutral-800",
};

export const localLabel = (local: string) => local.replace("T", " ");

const ScheduledCard = ({ item }: { item: ScheduledRideView }) => {
  const { t } = useI18n();
  return (
    <View>
      <View className="flex flex-row items-center justify-between">
        <Text className="text-base font-JakartaBold flex-1 pr-2">
          {localLabel(item.localTime)}
        </Text>
        <Text className={`text-xs px-2 py-1 rounded-full ${TONE[item.state]}`}>
          {t(`schedule.state.${item.state}`)}
        </Text>
      </View>
      <Text className="text-xs text-general-200 mt-1">{item.timezone}</Text>
      <Text className="text-sm mt-2" numberOfLines={1}>
        {item.pickup.address} → {item.destination.address}
      </Text>
    </View>
  );
};

export default ScheduledCard;
