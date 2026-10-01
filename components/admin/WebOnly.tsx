import { Text, View } from "react-native";

import { useI18n } from "@/lib/i18n";

const WebOnly = () => {
  const { t } = useI18n();
  return (
    <View className="flex-1 items-center justify-center p-8 bg-white">
      <Text
        className="text-lg font-JakartaBold text-center"
        accessibilityRole="header"
      >
        {t("booking.webOnly.title")}
      </Text>
      <Text className="text-base text-center mt-2">
        {t("booking.webOnly.body")}
      </Text>
    </View>
  );
};

export default WebOnly;
