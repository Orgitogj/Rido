import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
import RideCard from "@/components/RideCard";
import { useApi } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
import { mergeById } from "@/lib/paging";

import type { Page, RideView } from "@/shared/contracts";

const PAGE_SIZE = 20;

const Rides = () => {
  const { t, error: errorText } = useI18n();
  const request = useApi();
  const [items, setItems] = useState<RideView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "loading" | "refreshing" | "more" | "ready" | "error"
  >("loading");
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0);

  const load = useCallback(
    async (mode: "first" | "refresh" | "more", cursor: string | null) => {
      const id = ++latest.current;
      setStatus(
        mode === "more"
          ? "more"
          : mode === "refresh"
            ? "refreshing"
            : "loading",
      );
      setError(null);
      try {
        const page = await request<Page<RideView>>(
          `/api/rides/history?limit=${PAGE_SIZE}${mode === "more" && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        if (id !== latest.current) return;
        setItems((current) =>
          mode === "more" ? mergeById(current, page.items) : page.items,
        );
        setNextCursor(page.nextCursor);
        setStatus("ready");
      } catch (e) {
        if (id !== latest.current) return;
        setError(e);
        setStatus("error");
      }
    },
    [request],
  );

  useFocusEffect(
    useCallback(() => {
      load("refresh", null);
    }, [load]),
  );

  return (
    <SafeAreaView className="flex-1 bg-white">
      <FlatList
        data={items}
        renderItem={({ item }) => <RideCard ride={item} />}
        keyExtractor={(item) => item.id}
        className="px-5"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingBottom: 120,
        }}
        refreshControl={
          <RefreshControl
            refreshing={status === "refreshing" && items.length > 0}
            onRefresh={() => load("refresh", null)}
          />
        }
        ListEmptyComponent={
          status === "loading" || status === "refreshing" ? (
            <ListState
              kind="loading"
              message={t("booking.home.loadingRides")}
            />
          ) : status === "error" ? (
            <ListState
              kind="error"
              message={errorText(error)}
              onRetry={() => load("first", null)}
            />
          ) : (
            <ListState kind="empty" message={t("booking.history.empty")} />
          )
        }
        ListHeaderComponent={
          <>
            <Text
              className="text-2xl font-JakartaBold my-5"
              accessibilityRole="header"
            >
              {t("booking.history.title")}
            </Text>
            {status === "error" && items.length > 0 && (
              <Text
                className="text-sm text-red-600 mb-3"
                accessibilityLiveRegion="polite"
              >
                {t("booking.history.refreshFailed")}
              </Text>
            )}
          </>
        }
        ListFooterComponent={
          nextCursor && items.length > 0 ? (
            <View className="mt-2">
              <CustomButton
                title={
                  status === "more" ? t("common.loading") : t("common.loadMore")
                }
                bgVariant="outline"
                textVariant="primary"
                disabled={status === "more"}
                onPress={() => load("more", nextCursor)}
              />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
};

export default Rides;
