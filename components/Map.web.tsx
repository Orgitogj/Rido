import { Text, View } from "react-native";

import { useI18n } from "@/lib/i18n";

const Map = () => {
  const { t } = useI18n();
  return (
    <View className="flex-1 w-full items-center justify-center rounded-2xl bg-general-500 p-5">
      <Text className="text-sm text-general-200 text-center">
        {t("ride.panel.mapWeb")}
      </Text>
    </View>
  );
};

export default Map;
