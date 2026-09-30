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
import { ApiRequestError, useApi } from "@/lib/fetch";
import { SAFETY_CATEGORY_LABEL } from "@/lib/safetyText";
import { useChat } from "@/lib/useChat";
import {
  CHAT_RULES,
  type ChatState,
  SAFETY_RULES,
  safetyCategories,
  type SafetyCategory,
} from "@/shared/contracts";

import type { ChatItem } from "@/lib/chatThread";

const STATE_TEXT: Record<Exclude<ChatState, "open">, string> = {
  waiting: "You can message once a driver accepts your ride.",
  closed:
    "This ride has ended. You can read the conversation, but not send new messages.",
  expired: "This conversation is no longer available.",
  unavailable: "Messaging isn't available for this ride.",
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const ReportPanel = ({
  rideId,
  item,
  onClose,
}: {
  rideId: string;
  item: ChatItem;
  onClose: (sent: boolean) => void;
}) => {
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
      setError(
        e instanceof ApiRequestError ? e.message : "Couldn't send the report.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <View className="bg-white px-4 py-3 border-t border-neutral-200">
      <Text className="text-base font-JakartaBold">Report this message</Text>
      <Text className="text-xs text-general-200 mt-1" numberOfLines={2}>
        “{item.body}”
      </Text>
      <View className="flex flex-row flex-wrap mt-2">
        {safetyCategories.map((c) => (
          <Pressable
            key={c}
            onPress={() => setCategory(c)}
            accessibilityRole="radio"
            accessibilityState={{ checked: category === c }}
            className={`px-3 py-1.5 rounded-full mr-2 mb-2 border ${category === c ? "bg-[#0286FF] border-[#0286FF]" : "border-neutral-300"}`}
          >
            <Text className={category === c ? "text-white text-xs" : "text-xs"}>
              {SAFETY_CATEGORY_LABEL[c]}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="Anything else we should know? (optional)"
        multiline
        maxLength={SAFETY_RULES.descriptionMaxLength}
        accessibilityLabel="Optional details"
        className="border border-neutral-200 rounded-xl px-3 py-2 max-h-[100px]"
      />
      <Text className="text-xs text-general-200 mt-1">
        Our safety team sees only this message, not the rest of your
        conversation.
      </Text>
      {tooShort && (
        <Text className="text-xs text-red-500 mt-1">
          Add at least {SAFETY_RULES.descriptionMinLength} characters, or leave
          it empty.
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
            title={sending ? "Sending…" : error ? "Try again" : "Send report"}
            bgVariant="danger"
            disabled={sending || tooShort}
            onPress={submit}
          />
        </View>
        <View className="flex-1">
          <CustomButton
            title="Cancel"
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
  const reportable = !item.mine && item.id !== null;
  const failed = item.delivery === "failed";
  const status =
    item.delivery === "sending"
      ? "Sending…"
      : failed
        ? (item.error ?? "Not sent. Tap to retry.")
        : time(item.createdAt);
  const bubble = (
    <View
      className={`max-w-[80%] rounded-2xl px-4 py-2 ${item.mine ? "bg-[#0286FF] self-end" : "bg-white self-start"} ${failed ? "opacity-70" : ""}`}
    >
      {item.earlierDriver && (
        <Text className="text-[10px] text-general-200 mb-1">
          Previous driver
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
          accessibilityLabel={`Message not sent: ${item.body}. Tap to retry.`}
        >
          {bubble}
        </Pressable>
      ) : reportable ? (
        <Pressable
          onLongPress={() => onReport(item)}
          accessibilityHint="Long press to report this message"
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
          className={`text-[11px] ${failed ? "text-red-500" : "text-general-200"}`}
          accessibilityLiveRegion={failed ? "polite" : "none"}
        >
          {status}
        </Text>
        {reportable && (
          <Pressable
            onPress={() => onReport(item)}
            accessibilityRole="button"
            accessibilityLabel="Report this message"
            className="ml-3"
          >
            <Text className="text-[11px] text-red-500">Report</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
};

const ChatScreen = () => {
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
      (chat.role === "passenger" ? "Your driver" : "Passenger"))
    : "Messages";

  const submit = () => {
    const text = draft.trim();
    if (!text || !chat?.canSend) return;
    setDraft("");
    send(text);
  };

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <View className="flex flex-row items-center justify-between px-4 py-3 bg-white">
        <Pressable onPress={back} accessibilityRole="button" className="pr-3">
          <Text className="text-base text-[#0286FF]">Back</Text>
        </Pressable>
        <Text
          className="text-lg font-JakartaBold flex-1 text-center"
          numberOfLines={1}
        >
          {title}
        </Text>
        <View className="w-12" />
      </View>

      {connection === "reconnecting" && load === "ready" && (
        <View className="bg-orange-100 px-4 py-2">
          <Text className="text-xs text-orange-700">
            Reconnecting… new messages will appear when the connection is back.
          </Text>
        </View>
      )}

      {load === "loading" && items.length === 0 && (
        <ListState kind="loading" message="Loading messages…" />
      )}
      {load === "not_found" && (
        <ListState
          kind="empty"
          message="This conversation isn't available to you."
        />
      )}
      {load === "error" && items.length === 0 && (
        <ListState
          kind="error"
          message={loadError ?? "Couldn't load messages."}
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
                {chat?.canSend
                  ? "No messages yet. Messages are only shared between you and your current ride partner."
                  : ""}
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
                Report sent to our safety team. You can follow it from the
                ride&apos;s Safety screen.
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
                {STATE_TEXT[chat.state]}
              </Text>
            </View>
          )}

          {chat?.canSend && (
            <View className="flex flex-row items-end bg-white px-3 py-2">
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Message"
                multiline
                maxLength={CHAT_RULES.maxLength}
                accessibilityLabel="Message"
                className="flex-1 border border-neutral-200 rounded-2xl px-3 py-2 max-h-[120px]"
              />
              <View className="w-24 ml-2">
                <CustomButton
                  title="Send"
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
