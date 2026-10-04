import { useState } from "react";
import { Linking, Text, TouchableOpacity, View } from "react-native";

import { useApi } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
import { SUPPORT_RULES } from "@/shared/account";

import type { useSupportAttachments } from "@/lib/supportUploads";
import type {
  SupportAttachmentAccess,
  SupportAttachmentView,
} from "@/shared/account";

type Controller = ReturnType<typeof useSupportAttachments>;

const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

export const AttachmentPicker = ({
  controller,
  max,
  disabled,
}: {
  controller: Controller;
  max: number;
  disabled?: boolean;
}) => {
  const { t } = useI18n();
  const { list, pick, retry, remove, pickProblem } = controller;
  if (max <= 0 && list.length === 0) return null;

  return (
    <View className="mt-3">
      <Text className="text-sm font-JakartaSemiBold">
        {t("support.attachments.title")}
      </Text>
      <Text className="text-xs text-general-200 mt-1">
        {t("support.attachments.hint", {
          size: Math.round(SUPPORT_RULES.attachmentMaxBytes / (1024 * 1024)),
          count: max,
        })}
      </Text>

      {list.map((a) => (
        <View
          key={a.localId}
          className="bg-neutral-100 rounded-xl p-3 mt-2"
          accessibilityLiveRegion="polite"
        >
          <View className="flex flex-row items-center justify-between">
            <Text className="text-sm flex-1 pr-2" numberOfLines={1}>
              {a.name} · {megabytes(a.size)} MB
            </Text>
            <TouchableOpacity
              onPress={() => remove(a.localId)}
              accessibilityRole="button"
              accessibilityLabel={`${t("common.remove")} ${a.name}`}
              className="min-h-[44px] justify-center pl-3"
            >
              <Text className="text-sm text-red-600">{t("common.remove")}</Text>
            </TouchableOpacity>
          </View>
          {(a.status === "uploading" || a.status === "checking") && (
            <>
              <View
                className="h-2 rounded-full bg-neutral-300 mt-1 overflow-hidden"
                accessibilityRole="progressbar"
                accessibilityValue={{
                  min: 0,
                  max: 100,
                  now: Math.round(a.progress * 100),
                }}
              >
                <View
                  className="h-2 bg-[#0066CC]"
                  style={{ width: `${Math.round(a.progress * 100)}%` }}
                />
              </View>
              <Text className="text-xs text-general-200 mt-1">
                {a.status === "checking"
                  ? t("support.attachments.checking")
                  : t("support.attachments.uploading", {
                      percent: Math.round(a.progress * 100),
                    })}
              </Text>
            </>
          )}
          {a.status === "ready" && (
            <Text className="text-xs text-green-700 mt-1">
              {t("support.attachments.ready")}
            </Text>
          )}
          {a.status === "failed" && (
            <View className="flex flex-row items-center justify-between mt-1">
              <Text className="text-xs text-red-600 flex-1 pr-2">
                {t(`support.attachments.problem.${a.problem ?? "failed"}`)}
              </Text>
              {a.problem !== "unavailable" && a.problem !== "rejected" && (
                <TouchableOpacity
                  onPress={() => retry(a.localId)}
                  accessibilityRole="button"
                  className="min-h-[44px] justify-center pl-3"
                >
                  <Text className="text-sm text-[#0066CC] font-JakartaSemiBold">
                    {t("common.retry")}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      ))}

      {pickProblem && (
        <Text
          className="text-xs text-red-600 mt-2"
          accessibilityLiveRegion="polite"
        >
          {t(`support.attachments.problem.${pickProblem}`)}
        </Text>
      )}

      {list.length < max && (
        <TouchableOpacity
          onPress={pick}
          disabled={disabled}
          accessibilityRole="button"
          className={`min-h-[44px] justify-center mt-1 ${disabled ? "opacity-50" : ""}`}
        >
          <Text className="text-sm text-[#0066CC] font-JakartaSemiBold">
            {t("support.attachments.add")}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

export const AttachmentLinks = ({
  requestId,
  attachments,
  light,
}: {
  requestId: string;
  attachments: SupportAttachmentView[];
  light?: boolean;
}) => {
  const { t } = useI18n();
  const request = useApi();
  const [opening, setOpening] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (!attachments.length) return null;

  const open = async (id: string) => {
    setOpening(id);
    setFailed(null);
    try {
      const access = await request<SupportAttachmentAccess>(
        `/api/support/${requestId}/attachments/${id}/access`,
        { method: "POST" },
      );
      await Linking.openURL(access.url);
    } catch {
      setFailed(id);
    } finally {
      setOpening(null);
    }
  };

  return (
    <View className="mt-1">
      {attachments.map((a, index) => (
        <TouchableOpacity
          key={a.id}
          onPress={() => open(a.id)}
          disabled={opening !== null}
          accessibilityRole="link"
          className="min-h-[44px] justify-center"
        >
          <Text
            className={`text-sm font-JakartaSemiBold ${light ? "text-white underline" : "text-[#0066CC]"}`}
          >
            {opening === a.id
              ? t("common.loading")
              : t("support.attachments.open", { number: index + 1 })}
          </Text>
          {failed === a.id && (
            <Text
              className={`text-xs ${light ? "text-white" : "text-red-600"}`}
              accessibilityLiveRegion="polite"
            >
              {t("support.attachments.openFailed")}
            </Text>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
};
