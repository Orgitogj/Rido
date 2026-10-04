import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import ScreenHeader from "@/components/ScreenHeader";
import { AttachmentPicker } from "@/components/SupportAttachments";
import { useApi, useApiQuery } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
import { newClientId } from "@/lib/places";
import { useSupportAttachments } from "@/lib/supportUploads";
import {
  type AccountProfile,
  SUPPORT_RULES,
  type SupportCategory,
  supportCategoriesFor,
  type SupportConversation,
  type SupportRole,
} from "@/shared/account";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NewSupportRequest = () => {
  const params = useLocalSearchParams<{ rideId?: string; role?: string }>();
  const rideId =
    typeof params.rideId === "string" && UUID.test(params.rideId)
      ? params.rideId
      : null;
  const fixedRole: SupportRole | null =
    params.role === "driver" || params.role === "passenger"
      ? params.role
      : null;
  const { t, error: errorText } = useI18n();
  const request = useApi();
  const me = useApiQuery<AccountProfile>(fixedRole ? null : "/api/me");
  const [chosenRole, setChosenRole] = useState<SupportRole>("passenger");
  const role = fixedRole ?? chosenRole;
  const categories = useMemo(
    () => supportCategoriesFor(role, rideId !== null),
    [role, rideId],
  );
  const [category, setCategory] = useState<SupportCategory | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRequestId = useRef(newClientId());
  const attachments = useSupportAttachments(
    SUPPORT_RULES.attachmentsPerMessage,
  );
  const selected = category && categories.includes(category) ? category : null;
  const canChooseRole = !fixedRole && !rideId && Boolean(me.data?.driver);

  const submit = async () => {
    if (!selected || sending) return;
    setSending(true);
    setError(null);
    try {
      const created = await request<SupportConversation>("/api/support", {
        body: {
          role,
          rideId,
          category: selected,
          message: message.trim(),
          clientRequestId: clientRequestId.current,
          attachmentIds: attachments.readyIds,
        },
      });
      attachments.clear();
      router.replace({
        pathname: "/(root)/support/[id]",
        params: { id: created.id },
      });
    } catch (e) {
      setError(errorText(e));
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
          contentContainerStyle={{ paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
        >
          <ScreenHeader title={t("support.newTitle")} />
          <Text className="text-sm text-general-200 mb-1">
            {rideId ? t("support.aboutRide") : t("support.aboutAccount")}
          </Text>
          <Text className="text-xs text-general-200 mb-3">
            {t("support.notEmergency")}
          </Text>

          <View className="bg-white rounded-2xl p-4">
            {canChooseRole && (
              <>
                <Text className="text-sm font-JakartaSemiBold">
                  {t("support.askingAs")}
                </Text>
                <View
                  className="flex flex-row mt-2 mb-3"
                  accessibilityRole="radiogroup"
                >
                  {(["passenger", "driver"] as const).map((r) => (
                    <Pressable
                      key={r}
                      onPress={() => {
                        setChosenRole(r);
                        setCategory(null);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: role === r }}
                      className={`px-4 min-h-[44px] justify-center rounded-full mr-2 border ${role === r ? "bg-[#0066CC] border-[#0066CC]" : "border-neutral-400"}`}
                    >
                      <Text
                        className={role === r ? "text-white" : "text-black"}
                      >
                        {t(`support.role.${r}`)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <Text className="text-sm font-JakartaSemiBold">
              {t("support.categoryLabel")}
            </Text>
            <View accessibilityRole="radiogroup">
              {categories.map((c) => (
                <CustomButton
                  key={c}
                  title={t(`support.category.${c}`)}
                  bgVariant={selected === c ? "primary" : "outline"}
                  textVariant={selected === c ? "default" : "primary"}
                  className="mt-2"
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected === c }}
                  onPress={() => setCategory(c)}
                />
              ))}
            </View>

            <Text className="text-sm font-JakartaSemiBold mt-4">
              {t("support.messageLabel")}
            </Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder={t("support.messagePlaceholder")}
              placeholderTextColor="#6b6b6b"
              multiline
              maxLength={SUPPORT_RULES.messageMax}
              accessibilityLabel={t("support.messageLabel")}
              className="min-h-[110px] rounded-xl bg-neutral-100 p-3 text-base mt-2"
              style={{ textAlignVertical: "top" }}
            />

            <AttachmentPicker
              controller={attachments}
              max={SUPPORT_RULES.attachmentsPerMessage}
              disabled={sending}
            />

            {error && (
              <Text
                className="text-sm text-red-600 mt-3"
                accessibilityLiveRegion="polite"
              >
                {error}
              </Text>
            )}
            {attachments.blocked && (
              <Text className="text-xs text-general-200 mt-3">
                {t("support.attachments.wait")}
              </Text>
            )}
            <CustomButton
              title={sending ? t("common.sending") : t("support.submit")}
              disabled={
                sending ||
                !selected ||
                message.trim().length < 5 ||
                attachments.blocked
              }
              className="mt-3"
              onPress={submit}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default NewSupportRequest;
