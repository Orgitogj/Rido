import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
import ScreenHeader from "@/components/ScreenHeader";
import StatusBadge from "@/components/StatusBadge";
import { apiBaseUrl, useApi, useApiQuery } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
import { shareUrl } from "@/lib/safetyText";
import {
  SAFETY_RULES,
  safetyCategories,
  type SafetyCategory,
  type SafetyView,
  type TripShareCreated,
} from "@/shared/contracts";

const Row = ({ label, value }: { label: string; value: string }) => (
  <View className="flex flex-row justify-between py-2 border-b border-general-700">
    <Text className="text-sm text-general-200">{label}</Text>
    <Text
      className="text-sm font-JakartaSemiBold ml-4 flex-shrink text-right"
      selectable
    >
      {value}
    </Text>
  </View>
);

const ReportForm = ({
  rideId,
  initialCategory,
  onSent,
  onCancel,
}: {
  rideId: string;
  initialCategory: SafetyCategory;
  onSent: () => void;
  onCancel: () => void;
}) => {
  const { t, error: errorText } = useI18n();
  const request = useApi();
  const [category, setCategory] = useState<SafetyCategory>(initialCategory);
  const [description, setDescription] = useState("");
  const [clientReportId] = useState(() => Crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const length = description.trim().length;

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      await request(`/api/rides/${rideId}/safety-reports`, {
        body: { category, description: description.trim(), clientReportId },
      });
      onSent();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <View className="bg-white rounded-2xl p-5 mt-4">
      <Text className="text-base font-JakartaBold" accessibilityRole="header">
        {t("safety.report")}
      </Text>
      <View
        className="flex flex-row flex-wrap mt-3"
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
            <Text className={category === c ? "text-white text-sm" : "text-sm"}>
              {t(`safety.category.${c}`)}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder={t("safety.placeholder")}
        multiline
        maxLength={SAFETY_RULES.descriptionMaxLength}
        accessibilityLabel={t("safety.describe")}
        className="border border-neutral-300 rounded-xl p-3 mt-2 min-h-[110px]"
      />
      <Text className="text-xs text-general-200 mt-1">
        {t("safety.counter", {
          length,
          max: SAFETY_RULES.descriptionMaxLength,
          min: SAFETY_RULES.descriptionMinLength,
        })}
      </Text>
      {error && (
        <Text
          className="text-sm text-red-500 mt-2"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}
      <CustomButton
        title={
          sending
            ? t("common.sending")
            : error
              ? t("common.retry")
              : t("safety.send")
        }
        disabled={sending || length < SAFETY_RULES.descriptionMinLength}
        className="mt-3"
        onPress={submit}
      />
      <CustomButton
        title={t("common.cancel")}
        bgVariant="outline"
        textVariant="primary"
        className="mt-2"
        disabled={sending}
        onPress={onCancel}
      />
    </View>
  );
};

const ShareSection = ({
  view,
  onChanged,
}: {
  view: SafetyView;
  onChanged: () => void;
}) => {
  const { t, tn, error: errorText, dateTime } = useI18n();
  const request = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const active = view.shares.filter((s) => s.active);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await request<TripShareCreated>(
        `/api/rides/${view.rideId}/shares`,
        { body: {} },
      );
      const url = shareUrl(apiBaseUrl(), created.path);
      setLatest(url);
      onChanged();
      await Share.share({
        message: t("safety.share.message", { url }),
      }).catch(() => undefined);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await request(`/api/shares/${id}/revoke`, { method: "POST", body: {} });
      setLatest(null);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!view.canShare && active.length === 0) return null;
  return (
    <View className="bg-white rounded-2xl p-5 mt-4">
      <Text className="text-base font-JakartaBold" accessibilityRole="header">
        {t("safety.share.title")}
      </Text>
      <Text className="text-xs text-general-200 mt-1">
        {t("safety.share.body", {
          hours: SAFETY_RULES.shareTtlMinutes / 60,
          minutes: SAFETY_RULES.shareAfterTripMinutes,
        })}
      </Text>
      {latest && (
        <Text className="text-xs mt-2" selectable>
          {latest}
        </Text>
      )}
      {active.map((s) => (
        <View
          key={s.id}
          className="flex flex-row items-center justify-between border-t border-general-700 mt-2 pt-2"
        >
          <Text className="text-sm flex-1">
            {t("safety.share.active", { date: dateTime(s.expiresAt) })} ·{" "}
            {tn("safety.share.views", s.views)}
          </Text>
          <Pressable
            onPress={() => revoke(s.id)}
            disabled={busy}
            accessibilityRole="button"
            className="min-h-[44px] justify-center pl-3"
          >
            <Text className="text-sm text-red-600">
              {t("safety.share.stop")}
            </Text>
          </Pressable>
        </View>
      ))}
      {error && (
        <Text
          className="text-sm text-red-500 mt-2"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}
      {view.canShare && (
        <CustomButton
          title={busy ? t("safety.share.working") : t("safety.share.create")}
          disabled={busy}
          className="mt-3"
          onPress={create}
        />
      )}
    </View>
  );
};

const SafetyScreen = () => {
  const { t, tn, queryError, dateTime } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const rideId = String(id);
  const query = useApiQuery<SafetyView>(`/api/rides/${rideId}/safety`, {
    refetchOnFocus: true,
  });
  const [form, setForm] = useState<SafetyCategory | null>(null);
  const [sent, setSent] = useState(false);
  const v = query.data;

  const back = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({
          pathname: "/(root)/ride/[id]",
          params: { id: rideId },
        });

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <ScrollView
        className="px-5"
        contentContainerStyle={{ paddingBottom: 60 }}
      >
        <ScreenHeader title={t("safety.title")} onBack={back} />

        <View className="bg-red-50 rounded-2xl p-4" accessibilityRole="alert">
          <Text className="text-sm text-red-700 font-JakartaSemiBold">
            {t("safety.emergency")}
          </Text>
        </View>

        {!v && query.status === "loading" && (
          <ListState kind="loading" message={t("common.loading")} />
        )}
        {!v && query.status === "error" && (
          <ListState
            kind="error"
            message={queryError(query)}
            onRetry={query.refetch}
          />
        )}

        {v && (
          <>
            <View className="bg-white rounded-2xl px-5 py-3 mt-4">
              <Row label={t("safety.rideId")} value={v.rideId} />
              <View className="flex flex-row justify-between items-center py-2 border-b border-general-700">
                <Text className="text-sm text-general-200">
                  {t("safety.rideStatus")}
                </Text>
                <StatusBadge status={v.status} />
              </View>
              {v.driver && (
                <>
                  <Row label={t("safety.driver")} value={v.driver.name} />
                  <Row label={t("safety.vehicle")} value={v.driver.vehicle} />
                  <Row label={t("safety.plate")} value={v.driver.plate} />
                </>
              )}
              {v.passengerName && (
                <Row label={t("safety.passenger")} value={v.passengerName} />
              )}
              {!v.currentParticipant && (
                <Text className="text-xs text-general-200 py-2">
                  {t("safety.notAssigned")}
                </Text>
              )}
            </View>

            {sent && (
              <View className="bg-green-50 rounded-2xl p-4 mt-4">
                <Text
                  className="text-sm text-green-700"
                  accessibilityLiveRegion="polite"
                >
                  {t("safety.sent")}
                </Text>
              </View>
            )}

            {form ? (
              <ReportForm
                rideId={rideId}
                initialCategory={form}
                onCancel={() => setForm(null)}
                onSent={() => {
                  setForm(null);
                  setSent(true);
                  query.refetch();
                }}
              />
            ) : v.canReport ? (
              <View className="mt-4">
                <CustomButton
                  title={t("safety.report")}
                  bgVariant="danger"
                  onPress={() => {
                    setSent(false);
                    setForm("unsafe_driving");
                  }}
                />
                <CustomButton
                  title={t("safety.contactSupport")}
                  bgVariant="outline"
                  textVariant="primary"
                  className="mt-3"
                  onPress={() => {
                    if (v.role === "passenger" && v.currentParticipant) {
                      router.push({
                        pathname: "/(root)/receipt/[id]",
                        params: { id: rideId },
                      });
                      return;
                    }
                    setSent(false);
                    setForm("other");
                  }}
                />
                {v.reportBy && (
                  <Text className="text-xs text-general-200 mt-2">
                    {t("safety.reportUntil", { date: dateTime(v.reportBy) })}
                  </Text>
                )}
              </View>
            ) : (
              <Text className="text-sm text-general-200 mt-4">
                {t("safety.reportEnded")}
              </Text>
            )}

            {v.role === "passenger" && (
              <ShareSection view={v} onChanged={query.refetch} />
            )}

            <View className="bg-white rounded-2xl px-5 py-3 mt-4">
              <Text
                className="text-base font-JakartaBold py-2"
                accessibilityRole="header"
              >
                {t("safety.yourReports")}
              </Text>
              {v.reports.length === 0 && (
                <Text className="text-sm text-general-200 pb-2">
                  {t("safety.noReports")}
                </Text>
              )}
              {v.reports.map((r) => (
                <View key={r.id} className="py-2 border-t border-general-700">
                  <View className="flex flex-row justify-between">
                    <Text className="text-sm font-JakartaSemiBold">
                      {t(`safety.category.${r.category}`)}
                    </Text>
                    <Text className="text-sm text-general-200">
                      {t(`safety.status.${r.status}`)}
                    </Text>
                  </View>
                  <Text className="text-xs text-general-200 mt-1">
                    {t("safety.sentOn", { date: dateTime(r.createdAt) })}
                    {r.reportedMessages > 0
                      ? ` · ${tn("safety.attached", r.reportedMessages)}`
                      : ""}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default SafetyScreen;
