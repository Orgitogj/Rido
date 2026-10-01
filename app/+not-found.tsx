import { Link, Stack } from "expo-router";
import { Text, View } from "react-native";

import { useI18n } from "@/lib/i18n";

export default function NotFoundScreen() {
  const { t } = useI18n();
  return (
    <>
      <Stack.Screen options={{ title: t("booking.notFound.title") }} />
      <View className="flex-1 items-center justify-center p-5 bg-white">
        <Text className="text-base text-center" accessibilityRole="header">
          {t("booking.notFound.title")}
        </Text>
        <Link href="/" className="mt-4 py-4">
          <Text className="text-base text-[#0066CC] font-JakartaSemiBold">
            {t("booking.notFound.home")}
          </Text>
        </Link>
      </View>
    </>
  );
}
