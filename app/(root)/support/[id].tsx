import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
import ScreenHeader from "@/components/ScreenHeader";
import { ApiRequestError, useApi } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
import { newClientId } from "@/lib/places";
import { SUPPORT_RULES, type SupportConversation } from "@/shared/account";

const KNOWN = [
  "charge_question",
  "trip_problem",
  "driver_issue",
  "other",
] as const;
const categoryKey = (c: string) =>
  (KNOWN as readonly string[]).includes(c)
    ? (c as (typeof KNOWN)[number])
    : "other";

const SupportThread = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, error: errorText, dateTime } = useI18n();
  const request = useApi();
  const [data, setData] = useState<SupportConversation | null>(null);
  const [status, setStatus] = useState<
    "loading" | "ready" | "error" | "missing"
  >("loading");
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const pendingId = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await request<SupportConversation>(`/api/support/${id}`));
      setStatus("ready");
    } catch (e) {
      setError(e);
      setStatus(
        e instanceof ApiRequestError && (e.status === 404 || e.status === 400)
          ? "missing"
          : "error",
      );
    }
  }, [id, request]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    pendingId.current ??= newClientId();
    setSending(true);
    setSendError(null);
    try {
      setData(
        await request<SupportConversation>(`/api/support/${id}/messages`, {
          body: { body, clientMessageId: pendingId.current },
        }),
      );
      pendingId.current = null;
      setDraft("");
    } catch (e) {
      setSendError(errorText(e));
      if (e instanceof ApiRequestError && e.code === "SUPPORT_CLOSED") load();
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          className="px-5"
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <ScreenHeader title={t("support.request")} />

          {status === "loading" && (
            <ListState kind="loading" message={t("common.loading")} />
          )}
          {status === "error" && (
            <ListState
              kind="error"
              message={errorText(error, t("support.loadFailed"))}
              onRetry={load}
            />
          )}
          {status === "missing" && (
            <ListState kind="empty" message={t("inbox.unavailable")} />
          )}

          {data && status === "ready" && (
            <>
              <View className="bg-white rounded-2xl p-4 mb-3">
                <Text className="text-base font-JakartaBold">
                  {t(`support.category.${categoryKey(data.category)}`)}
                </Text>
                <Text className="text-sm text-general-200 mt-1">
                  {t("support.tripTo", { destination: data.destination })}
                </Text>
                <Text className="text-sm mt-1">
                  {t(`support.status.${data.status}`)} ·{" "}
                  {dateTime(data.updatedAt)}
                </Text>
                <Text className="text-xs text-general-200 mt-3">
                  {t("support.yourMessage")}
                </Text>
                <Text className="text-sm mt-1" selectable>
                  {data.message}
                </Text>
              </View>

              {data.messages.map((m) => (
                <View
                  key={m.id}
                  className={`rounded-2xl p-3 mb-2 max-w-[88%] ${m.author === "user" ? "bg-[#0286FF] self-end" : "bg-white self-start"}`}
                >
                  <Text
                    className={`text-xs ${m.author === "user" ? "text-white" : "text-general-200"}`}
                  >
                    {m.author === "user" ? t("support.you") : t("support.team")}{" "}
                    · {dateTime(m.createdAt)}
                  </Text>
                  <Text
                    className={`text-sm mt-1 ${m.author === "user" ? "text-white" : "text-black"}`}
                    selectable
                  >
                    {m.body}
                  </Text>
                </View>
              ))}

              {data.resolutionMessage && (
                <View className="bg-green-50 rounded-2xl p-4 mt-2">
                  <Text className="text-sm font-JakartaBold">
                    {t("support.resolution")}
                  </Text>
                  <Text className="text-sm mt-1" selectable>
                    {data.resolutionMessage}
                  </Text>
                </View>
              )}

              {data.canReply ? (
                <View className="bg-white rounded-2xl p-4 mt-3">
                  <Text className="text-sm font-JakartaSemiBold mb-2">
                    {t("support.reply")}
                  </Text>
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    placeholder={t("support.replyPlaceholder")}
                    placeholderTextColor="#858585"
                    multiline
                    maxLength={SUPPORT_RULES.messageMax}
                    accessibilityLabel={t("support.reply")}
                    className="min-h-[80px] rounded-xl bg-neutral-100 p-3 text-base"
                    style={{ textAlignVertical: "top" }}
                  />
                  {sendError && (
                    <Text
                      className="text-sm text-red-500 mt-2"
                      accessibilityLiveRegion="polite"
                    >
                      {sendError}
                    </Text>
                  )}
                  <CustomButton
                    title={sending ? t("common.sending") : t("common.send")}
                    disabled={sending || !draft.trim()}
                    className="mt-3"
                    onPress={send}
                  />
                </View>
              ) : (
                <Text className="text-sm text-general-200 mt-3">
                  {t("support.closedHint")}
                </Text>
              )}
              <Text className="text-xs text-general-200 mt-3">
                {t("support.notEmergency")}
              </Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default SupportThread;
