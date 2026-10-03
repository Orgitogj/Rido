import { router } from "expo-router";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
import ScheduledCard from "@/components/ScheduledCard";
import ScreenHeader from "@/components/ScreenHeader";
import { useApiQuery } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";

import type { ScheduledRideList, ScheduledRideView } from "@/shared/schedule";

const ScheduledList = () => {
  const { t, queryError } = useI18n();
  const list = useApiQuery<ScheduledRideList>("/api/scheduled-rides", {
    refetchOnFocus: true,
  });
  const data = list.data;

  const row = (item: ScheduledRideView) => (
    <TouchableOpacity
      key={item.id}
      accessibilityRole="button"
      onPress={() =>
        router.push({
          pathname: "/(root)/scheduled/[id]",
          params: { id: item.id },
        })
      }
      className="bg-white rounded-2xl p-4 mb-3"
    >
      <ScheduledCard item={item} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <ScrollView
        className="px-5"
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        <ScreenHeader title={t("schedule.title")} />
        <Text className="text-sm text-general-200 mb-3">
          {t("schedule.notReservation")}
        </Text>
        <CustomButton
          title={t("schedule.scheduleLater")}
          className="mb-4"
          onPress={() => router.push("/(root)/find-ride")}
        />

        {!data && list.status === "loading" && (
          <ListState kind="loading" message={t("common.loading")} />
        )}
        {!data && list.status === "error" && (
          <ListState
            kind="error"
            message={queryError(list)}
            onRetry={list.refetch}
          />
        )}
        {data && data.upcoming.length === 0 && data.past.length === 0 && (
          <ListState kind="empty" message={t("schedule.empty")} />
        )}

        {data && data.upcoming.length > 0 && (
          <View>
            <Text
              className="text-lg font-JakartaBold mb-2"
              accessibilityRole="header"
            >
              {t("schedule.upcoming")}
            </Text>
            {data.upcoming.map(row)}
          </View>
        )}
        {data && data.past.length > 0 && (
          <View>
            <Text
              className="text-lg font-JakartaBold mt-3 mb-2"
              accessibilityRole="header"
            >
              {t("schedule.past")}
            </Text>
            {data.past.map(row)}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default ScheduledList;
