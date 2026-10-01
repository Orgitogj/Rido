import { router } from "expo-router";
import { Image, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
import StatusBadge from "@/components/StatusBadge";
import { images } from "@/constants";
import { useApiQuery } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";

import type { RideView } from "@/shared/contracts";

const Chat = () => {
  const { t, tn, queryError } = useI18n();
  const active = useApiQuery<RideView | null>("/api/rides/active", {
    refetchOnFocus: true,
  });
  const ride = active.data;
  const readable =
    ride &&
    (ride.chat.state === "open" ||
      (ride.chat.state === "closed" && ride.chat.latestSeq > 0));

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="px-5"
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 120 }}
      >
        <Text
          className="text-2xl font-JakartaBold my-5"
          accessibilityRole="header"
        >
          {t("chat.tabTitle")}
        </Text>

        {active.status === "loading" && !ride && (
          <ListState kind="loading" message={t("common.loading")} />
        )}
        {active.status === "error" && !ride && (
          <ListState
            kind="error"
            message={queryError(active)}
            onRetry={active.refetch}
          />
        )}

        {ride && (
          <View className="bg-general-500 rounded-2xl p-5">
            <View className="flex flex-row items-center justify-between">
              <Text className="text-base font-JakartaBold flex-1">
                {t("chat.tabActive")}
              </Text>
              <StatusBadge status={ride.status} />
            </View>
            <Text className="text-sm text-general-200 mt-2" numberOfLines={2}>
              {ride.pickup.address} → {ride.destination.address}
            </Text>
            {readable ? (
              <>
                {ride.chat.unread > 0 && (
                  <Text className="text-sm font-JakartaSemiBold mt-2">
                    {tn("chat.tabUnread", ride.chat.unread)}
                  </Text>
                )}
                <CustomButton
                  title={t("chat.tabOpen")}
                  className="mt-4"
                  onPress={() =>
                    router.push({
                      pathname: "/(root)/chat/[id]",
                      params: { id: ride.id },
                    })
                  }
                />
              </>
            ) : (
              <Text className="text-sm text-general-200 mt-2">
                {ride.chat.state === "waiting"
                  ? t("chat.tabWaiting")
                  : t(
                      `chat.state.${ride.chat.state === "open" ? "closed" : ride.chat.state}`,
                    )}
              </Text>
            )}
          </View>
        )}

        {active.status === "success" && !ride && (
          <View className="flex-1 justify-center items-center">
            <Image
              source={images.message}
              accessible={false}
              className="w-full h-40"
              resizeMode="contain"
            />
            <Text className="text-xl font-JakartaBold mt-3 text-center">
              {t("chat.tabEmptyTitle")}
            </Text>
            <Text className="text-base mt-2 text-center px-4">
              {t("chat.tabEmptyBody")}
            </Text>
            <Text className="text-sm text-general-200 mt-3 text-center px-4">
              {t("chat.tabDriving")}
            </Text>
          </View>
        )}

        <View className="mt-6 items-center">
          <Text className="text-sm text-general-200 text-center">
            {t("chat.tabSupport")}
          </Text>
          <TouchableOpacity
            accessibilityRole="link"
            className="min-h-[44px] justify-center"
            onPress={() => router.push("/(root)/support")}
          >
            <Text className="text-base text-[#0066CC] font-JakartaSemiBold">
              {t("chat.tabSupportLink")}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default Chat;
