import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
import { useApi } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
import { useChat } from "@/lib/useChat";
import {
  CHAT_RULES,
  SAFETY_RULES,
  safetyCategories,
  type SafetyCategory,
} from "@/shared/contracts";

import type { ChatItem } from "@/lib/chatThread";

const ReportPanel = ({
  rideId,
  item,
  onClose,
}: {
  rideId: string;
  item: ChatItem;
  onClose: (sent: boolean) => void;
}) => {
  const { t, error: errorText } = useI18n();
  const request = useApi();
  const [category, setCategory] = useState<SafetyCategory>("harassment");
  const [description, setDescription] = useState("");
  const [clientReportId] = useState(() => Crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const extra = description.trim();
  const tooShort =
    extra.length > 0 && extra.length < SAFETY_RULES.descriptionMinLength;

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      await request(`/api/rides/${rideId}/messages/${item.id}/report`, {
        body: {
          category,
          clientReportId,
          ...(extra ? { description: extra } : {}),
        },
      });
      onClose(true);
    } catch (e) {
      setError(errorText(e, t("chat.reportFailed")));
    } finally {
      setSending(false);
    }
  };

  return (
    <View className="bg-white px-4 py-3 border-t border-neutral-200">
      <Text className="text-base font-JakartaBold" accessibilityRole="header">
        {t("chat.reportTitle")}
      </Text>
      <Text className="text-xs text-general-200 mt-1" numberOfLines={2}>
        “{item.body}”
      </Text>
      <View
        className="flex flex-row flex-wrap mt-2"
        accessibilityRole="radiogroup"
      >
        {safetyCategories.map((c) => (
          <Pressable
            key={c}
            onPress={() => setCategory(c)}
            accessibilityRole="radio"
            accessibilityState={{ checked: category === c }}
            className={`px-3 min-h-[44px] justify-center rounded-full mr-2 mb-2 border ${category === c ? "bg-[#0286FF] border-[#0286FF]" : "border-neutral-400"}`}
          >
            <Text className={category === c ? "text-white text-xs" : "text-xs"}>
              {t(`safety.category.${c}`)}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder={t("chat.reportDetails")}
        multiline
        maxLength={SAFETY_RULES.descriptionMaxLength}
        accessibilityLabel={t("chat.reportDetailsLabel")}
        className="border border-neutral-200 rounded-xl px-3 py-2 max-h-[100px]"
      />
      <Text className="text-xs text-general-200 mt-1">
        {t("chat.reportScope")}
      </Text>
      {tooShort && (
        <Text className="text-xs text-red-500 mt-1">
          {t("chat.reportTooShort", {
            count: SAFETY_RULES.descriptionMinLength,
          })}
        </Text>
      )}
      {error && (
        <Text
          className="text-sm text-red-500 mt-1"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}
      <View className="flex flex-row mt-2">
        <View className="flex-1 mr-2">
          <CustomButton
            title={
              sending
                ? t("common.sending")
                : error
                  ? t("common.retry")
                  : t("chat.reportSend")
            }
            bgVariant="danger"
            disabled={sending || tooShort}
            onPress={submit}
          />
        </View>
        <View className="flex-1">
          <CustomButton
            title={t("common.cancel")}
            bgVariant="outline"
            textVariant="primary"
            disabled={sending}
            onPress={() => onClose(false)}
          />
        </View>
      </View>
    </View>
  );
};

const Bubble = ({
  item,
  onRetry,
  onReport,
}: {
  item: ChatItem;
  onRetry: (clientMessageId: string) => void;
  onReport: (item: ChatItem) => void;
}) => {
  const { t, clock } = useI18n();
  const reportable = !item.mine && item.id !== null;
  const failed = item.delivery === "failed";
  const status =
    item.delivery === "sending"
      ? t("common.sending")
      : failed
        ? t("chat.notSent")
        : clock(item.createdAt);
  const bubble = (
    <View
      className={`max-w-[80%] rounded-2xl px-4 py-2 ${item.mine ? "bg-[#0286FF] self-end" : "bg-white self-start"} ${failed ? "opacity-70" : ""}`}
    >
      {item.earlierDriver && (
        <Text className="text-[10px] text-general-200 mb-1">
          {t("chat.previousDriver")}
        </Text>
      )}
      <Text
        className={`text-base ${item.mine ? "text-white" : "text-black"}`}
        selectable
      >
        {item.body}
      </Text>
    </View>
  );
  return (
    <View className="px-4 py-1">
      {failed && item.clientMessageId ? (
        <Pressable
          onPress={() => onRetry(item.clientMessageId!)}
          accessibilityRole="button"
          accessibilityLabel={t("chat.notSentLabel", { body: item.body })}
        >
          {bubble}
        </Pressable>
      ) : reportable ? (
        <Pressable
          onLongPress={() => onReport(item)}
          accessibilityHint={t("chat.reportHint")}
        >
          {bubble}
        </Pressable>
      ) : (
        bubble
      )}
      <View
        className={`flex flex-row mt-0.5 ${item.mine ? "self-end" : "self-start"}`}
      >
        <Text
          className={`text-xs ${failed ? "text-red-600" : "text-general-200"}`}
          accessibilityLiveRegion={failed ? "polite" : "none"}
        >
          {status}
        </Text>
        {reportable && (
          <Pressable
            onPress={() => onReport(item)}
            accessibilityRole="button"
            accessibilityLabel={t("chat.reportTitle")}
            hitSlop={14}
            className="ml-3"
          >
            <Text className="text-xs text-red-600">{t("chat.report")}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
};

const ChatScreen = () => {
  const { t, language } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const rideId = String(id);
  const {
    items,
    chat,
    load,
    loadError,
    connection,
    hasMoreBefore,
    loadingOlder,
    send,
    retry,
    loadOlder,
    reload,
  } = useChat(rideId);
  const [draft, setDraft] = useState("");
  const [reporting, setReporting] = useState<ChatItem | null>(null);
  const [reported, setReported] = useState(false);

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({
          pathname: "/(root)/ride/[id]",
          params: { id: rideId },
        });

  const title = chat
    ? (chat.counterpartName ??
      (chat.role === "passenger" ? t("chat.yourDriver") : t("chat.passenger")))
    : t("chat.title");

  const submit = () => {
    const text = draft.trim();
    if (!text || !chat?.canSend) return;
    setDraft("");
    send(text);
  };

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <View className="flex flex-row items-center justify-between px-4 py-3 bg-white">
        <Pressable
          onPress={back}
          accessibilityRole="button"
          className="pr-3 min-h-[44px] justify-center"
        >
          <Text className="text-base text-[#0066CC]">{t("common.back")}</Text>
        </Pressable>
        <Text
          className="text-lg font-JakartaBold flex-1 text-center"
          numberOfLines={1}
          accessibilityRole="header"
        >
          {title}
        </Text>
        <View className="w-12" />
      </View>

      {connection === "reconnecting" && load === "ready" && (
        <View className="bg-orange-100 px-4 py-2">
          <Text className="text-xs text-orange-800">
            {t("chat.reconnecting")}
          </Text>
        </View>
      )}

      {load === "loading" && items.length === 0 && (
        <ListState kind="loading" message={t("chat.loading")} />
      )}
      {load === "not_found" && (
        <ListState kind="empty" message={t("chat.notAvailable")} />
      )}
      {load === "error" && items.length === 0 && (
        <ListState
          kind="error"
          message={
            language === "en" && loadError ? loadError : t("chat.loadFailed")
          }
          onRetry={reload}
        />
      )}

      {(load === "ready" || items.length > 0) && (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <FlatList
            inverted
            data={[...items].reverse()}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) => (
              <Bubble
                item={item}
                onRetry={retry}
                onReport={(m) => {
                  setReported(false);
                  setReporting(m);
                }}
              />
            )}
            onEndReached={hasMoreBefore ? loadOlder : undefined}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              loadingOlder ? (
                <ActivityIndicator className="my-3" color="#0286FF" />
              ) : null
            }
            ListEmptyComponent={
              <Text className="text-sm text-general-200 text-center mt-10 px-8">
                {chat?.canSend ? t("chat.empty") : ""}
              </Text>
            }
            contentContainerStyle={{ paddingVertical: 8, flexGrow: 1 }}
          />

          {reported && (
            <View className="bg-green-50 px-4 py-2">
              <Text
                className="text-sm text-green-700"
                accessibilityLiveRegion="polite"
              >
                {t("chat.reportSent")}
              </Text>
            </View>
          )}

          {reporting && (
            <ReportPanel
              rideId={rideId}
              item={reporting}
              onClose={(sent) => {
                setReporting(null);
                setReported(sent);
              }}
            />
          )}

          {chat && chat.state !== "open" && (
            <View className="bg-white px-4 py-3">
              <Text className="text-sm text-general-200">
                {t(`chat.state.${chat.state}`)}
              </Text>
            </View>
          )}

          {chat?.canSend && (
            <View className="flex flex-row items-end bg-white px-3 py-2">
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={t("chat.message")}
                multiline
                maxLength={CHAT_RULES.maxLength}
                accessibilityLabel={t("chat.message")}
                className="flex-1 border border-neutral-300 rounded-2xl px-3 py-2 min-h-[44px] max-h-[120px]"
              />
              <View className="w-24 ml-2">
                <CustomButton
                  title={t("common.send")}
                  disabled={!draft.trim()}
                  onPress={submit}
                />
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
};

export default ChatScreen;
