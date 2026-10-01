import { router } from "expo-router";
import { Text, TouchableOpacity, View } from "react-native";

import { useI18n } from "@/lib/i18n";

const ScreenHeader = ({
  title,
  onBack,
}: {
  title: string;
  onBack?: () => void;
}) => {
  const { t } = useI18n();
  return (
    <View className="flex flex-row items-center my-5">
      <TouchableOpacity
        onPress={onBack ?? (() => router.back())}
        accessibilityRole="button"
        accessibilityLabel={t("common.back")}
        className="w-11 h-11 rounded-full bg-white items-center justify-center mr-3"
      >
        <Text className="text-lg">←</Text>
      </TouchableOpacity>
      <Text
        className="text-2xl font-JakartaExtraBold flex-1"
        accessibilityRole="header"
      >
        {title}
      </Text>
    </View>
  );
};

export default ScreenHeader;
