import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, Switch, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
import ScreenHeader from "@/components/ScreenHeader";
import { useApi } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
import { useInbox } from "@/lib/inbox";
import { safeInternalRoute } from "@/lib/notificationRouting";
import { usePushStatus } from "@/lib/notifications";

import type { InboxItem, NotificationPreferences } from "@/shared/account";

const PREFERENCE_KEYS = [
  "rideUpdates",
  "chatMessages",
  "rideOffers",
  "accountUpdates",
] as const;

const Notifications = () => {
  const { t, tn, error: errorText, dateTime } = useI18n();
  const request = useApi();
  const inbox = useInbox();
  const pushStatus = usePushStatus((s) => s.status);
  const [preferences, setPreferences] =
    useState<NotificationPreferences | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const { reload } = inbox;

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  useEffect(() => {
    let cancelled = false;
    request<NotificationPreferences>("/api/notifications/preferences")
      .then((p) => {
        if (!cancelled) setPreferences(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [request]);

  const toggle = async (key: (typeof PREFERENCE_KEYS)[number]) => {
    if (!preferences) return;
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    setNote(null);
    try {
      setPreferences(
        await request<NotificationPreferences>(
          "/api/notifications/preferences",
          { method: "PUT", body: next },
        ),
      );
      setNote({ ok: true, text: t("inbox.saved") });
    } catch (e) {
      setPreferences(preferences);
      setNote({ ok: false, text: errorText(e) });
    }
  };

  const open = async (item: InboxItem) => {
    if (!item.readAt) inbox.markRead([item.id]);
    const route = safeInternalRoute(item.target);
    if (route && route !== "/notifications") router.push(route as never);
  };

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <ScrollView
        className="px-5"
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        <ScreenHeader title={t("inbox.title")} />

        {pushStatus !== "registered" && pushStatus !== "idle" && (
          <View className="bg-white rounded-2xl p-4 mb-4">
            <Text className="text-sm text-general-200">
              {pushStatus === "denied"
                ? t("inbox.pushOff")
                : pushStatus === "needs_dev_build"
                  ? t("inbox.pushNeedsBuild")
                  : t("inbox.pushUnavailable")}
            </Text>
          </View>
        )}

        <View className="flex flex-row items-center justify-between mb-3">
          <Text className="text-sm text-general-200">
            {tn("inbox.unread", inbox.unread)}
          </Text>
          {inbox.unread > 0 && (
            <TouchableOpacity
              onPress={inbox.markAllRead}
              accessibilityRole="button"
              className="min-h-[44px] justify-center"
            >
              <Text className="text-sm text-[#0286FF] font-JakartaSemiBold">
                {t("inbox.markAllRead")}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {inbox.status === "loading" && inbox.items.length === 0 && (
          <ListState kind="loading" message={t("common.loading")} />
        )}
        {inbox.status === "error" && inbox.items.length === 0 && (
          <ListState
            kind="error"
            message={errorText(inbox.error, t("inbox.loadFailed"))}
            onRetry={reload}
          />
        )}
        {inbox.status === "ready" && inbox.items.length === 0 && (
          <ListState kind="empty" message={t("inbox.empty")} />
        )}

        {inbox.items.map((item) => (
          <TouchableOpacity
            key={item.id}
            onPress={() => open(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.body}`}
            className={`rounded-2xl p-4 mb-3 ${item.readAt ? "bg-white" : "bg-[#E6F3FF]"}`}
          >
            <View className="flex flex-row justify-between">
              <Text className="text-xs text-general-200">
                {t(`inbox.category.${item.category}`)}
              </Text>
              <Text className="text-xs text-general-200">
                {dateTime(item.createdAt)}
              </Text>
            </View>
            <Text className="text-base font-JakartaBold mt-1">
              {item.title}
            </Text>
            <Text className="text-sm text-neutral-700 mt-1">{item.body}</Text>
          </TouchableOpacity>
        ))}

        {inbox.nextCursor && (
          <CustomButton
            title={
              inbox.status === "loading"
                ? t("common.loading")
                : t("common.loadMore")
            }
            bgVariant="outline"
            textVariant="primary"
            disabled={inbox.status === "loading"}
            onPress={inbox.loadMore}
          />
        )}

        <Text
          className="text-lg font-JakartaBold mt-6 mb-1"
          accessibilityRole="header"
        >
          {t("inbox.preferences")}
        </Text>
        <Text className="text-xs text-general-200 mb-3">
          {t("inbox.preferencesHint")}
        </Text>
        {preferences &&
          PREFERENCE_KEYS.map((key) => (
            <View
              key={key}
              className="bg-white rounded-2xl p-4 mb-3 flex flex-row items-center"
            >
              <View className="flex-1 pr-3">
                <Text className="text-base font-JakartaSemiBold">
                  {t(`inbox.${key}`)}
                </Text>
                <Text className="text-xs text-general-200 mt-1">
                  {t(`inbox.${key}Hint`)}
                </Text>
              </View>
              <Switch
                value={preferences[key]}
                onValueChange={() => toggle(key)}
                accessibilityLabel={t(`inbox.${key}`)}
              />
            </View>
          ))}
        {note && (
          <Text
            className={`text-sm ${note.ok ? "text-green-700" : "text-red-500"}`}
            accessibilityLiveRegion="polite"
          >
            {note.text}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default Notifications;
