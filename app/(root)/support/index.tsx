import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
import ScreenHeader from "@/components/ScreenHeader";
import { useApi } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
import {
  type MySupportRequest,
  supportCategories,
  type SupportCategory,
  type SupportStatus,
} from "@/shared/account";

interface SupportPage {
  items: MySupportRequest[];
  nextCursor: string | null;
}

const supportCategoryKey = (category: string): SupportCategory =>
  (supportCategories as readonly string[]).includes(category)
    ? (category as SupportCategory)
    : "other";

const STATUS_STYLE: Record<SupportStatus, string> = {
  open: "bg-orange-100 text-orange-800",
  in_progress: "bg-blue-100 text-blue-800",
  resolved: "bg-green-100 text-green-800",
};

const SupportList = () => {
  const { t, error: errorText, dateTime } = useI18n();
  const request = useApi();
  const [items, setItems] = useState<MySupportRequest[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(
    async (from: string | null) => {
      setStatus("loading");
      try {
        const page = await request<SupportPage>(
          `/api/support?limit=20${from ? `&cursor=${encodeURIComponent(from)}` : ""}`,
        );
        setItems((prev) => (from ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setStatus("ready");
      } catch (e) {
        setError(e);
        setStatus("error");
      }
    },
    [request],
  );

  useFocusEffect(
    useCallback(() => {
      load(null);
    }, [load]),
  );

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <ScrollView
        className="px-5"
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        <ScreenHeader title={t("support.title")} />
        <Text className="text-sm text-general-200 mb-2">
          {t("support.intro")}
        </Text>
        <Text className="text-xs text-general-200 mb-3">
          {t("support.notEmergency")}
        </Text>
        <CustomButton
          title={t("support.newRequest")}
          className="mb-4"
          onPress={() => router.push("/(root)/support/new")}
        />

        {status === "loading" && items.length === 0 && (
          <ListState kind="loading" message={t("common.loading")} />
        )}
        {status === "error" && items.length === 0 && (
          <ListState
            kind="error"
            message={errorText(error, t("support.loadFailed"))}
            onRetry={() => load(null)}
          />
        )}
        {status === "ready" && items.length === 0 && (
          <View>
            <ListState kind="empty" message={t("support.empty")} />
            <CustomButton
              title={t("support.openRides")}
              bgVariant="outline"
              textVariant="primary"
              className="mt-3"
              onPress={() => router.push("/(root)/(tabs)/rides")}
            />
          </View>
        )}

        {items.map((item) => (
          <TouchableOpacity
            key={item.id}
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: "/(root)/support/[id]",
                params: { id: item.id },
              })
            }
            className="bg-white rounded-2xl p-4 mb-3"
          >
            <View className="flex flex-row items-center justify-between">
              <Text className="text-base font-JakartaBold flex-1 pr-2">
                {t(`support.category.${supportCategoryKey(item.category)}`)}
              </Text>
              <Text
                className={`text-xs px-2 py-1 rounded-full ${STATUS_STYLE[item.status]}`}
              >
                {t(`support.status.${item.status}`)}
              </Text>
            </View>
            <Text className="text-sm text-general-200 mt-1" numberOfLines={1}>
              {item.destination
                ? t("support.tripTo", { destination: item.destination })
                : item.rideId
                  ? t("support.rideRequest")
                  : item.role === "driver"
                    ? t("support.driverRequest")
                    : t("support.accountRequest")}
            </Text>
            <View className="flex flex-row justify-between mt-2">
              <Text className="text-xs text-general-200">
                {dateTime(item.updatedAt)}
              </Text>
              {item.unread && (
                <Text className="text-xs text-[#0066CC] font-JakartaBold">
                  {t("support.newReply")}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        ))}

        {cursor && (
          <CustomButton
            title={
              status === "loading" ? t("common.loading") : t("common.loadMore")
            }
            bgVariant="outline"
            textVariant="primary"
            disabled={status === "loading"}
            onPress={() => load(cursor)}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default SupportList;
