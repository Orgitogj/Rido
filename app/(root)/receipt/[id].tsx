import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
import RatingCard from "@/components/RatingCard";
import ScreenHeader from "@/components/ScreenHeader";
import StatusBadge from "@/components/StatusBadge";
import TipSection from "@/components/TipSection";
import { useApi, useApiQuery } from "@/lib/fetch";
import { type I18n, useI18n } from "@/lib/i18n";

import type { PassengerSupportRequest, Receipt } from "@/shared/contracts";

const PENDING = ["hold_releasing", "charge_pending", "hold_active"];

const CATEGORIES = [
  "charge_question",
  "trip_problem",
  "driver_issue",
  "other",
] as const;
type Category = (typeof CATEGORIES)[number];

const isCategory = (value: string): value is Category =>
  (CATEGORIES as readonly string[]).includes(value);

function paymentText(r: Receipt, i18n: I18n) {
  const params = {
    fare: i18n.money(r.quotedFareCents),
    charged: i18n.money(r.chargedCents),
    refunded: i18n.money(r.refundedCents),
  };
  if (r.paymentState === "hold_expired" && r.outcome === "completed") {
    return i18n.t("pay.receipt.state.hold_expired_completed");
  }
  return i18n.t(`pay.receipt.state.${r.paymentState}`, params);
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <View className="flex flex-row justify-between py-2 border-b border-general-700">
    <Text className="text-sm text-general-200">{label}</Text>
    <Text className="text-sm font-JakartaSemiBold ml-4 flex-shrink text-right">
      {value}
    </Text>
  </View>
);

const ReceiptScreen = () => {
  const i18n = useI18n();
  const { t, error: errorText, queryError, money, dateTime } = i18n;
  const { id } = useLocalSearchParams<{ id: string }>();
  const request = useApi();
  const receipt = useApiQuery<Receipt>(`/api/receipts/${id}`, {
    refetchOnFocus: true,
  });
  const support = useApiQuery<PassengerSupportRequest[]>(
    `/api/rides/${id}/support`,
    { refetchOnFocus: true },
  );
  const [category, setCategory] = useState<Category>("charge_question");
  const [message, setMessage] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportState, setReportState] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const { refetch } = receipt;
  const r = receipt.data;

  useEffect(() => {
    if (!r || !PENDING.includes(r.paymentState)) return;
    const timer = setInterval(refetch, 5000);
    return () => clearInterval(timer);
  }, [r, refetch]);

  const report = async () => {
    setSending(true);
    try {
      await request(`/api/rides/${id}/support`, {
        body: { category, message },
      });
      setReportState({ ok: true, text: t("pay.receipt.reportSent") });
      setReportOpen(false);
      setMessage("");
      support.refetch();
    } catch (e) {
      setReportState({
        ok: false,
        text: errorText(e, t("pay.receipt.reportFailed")),
      });
    } finally {
      setSending(false);
    }
  };

  const close = () =>
    router.canGoBack() ? router.back() : router.replace("/(root)/(tabs)/rides");

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <ScrollView
        className="px-5"
        contentContainerStyle={{ paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader title={t("pay.receipt.title")} onBack={close} />

        {!r && receipt.status === "loading" && (
          <ListState kind="loading" message={t("pay.receipt.loading")} />
        )}
        {!r && receipt.status === "error" && (
          <ListState
            kind="error"
            message={queryError(receipt)}
            onRetry={refetch}
          />
        )}

        {r && (
          <>
            {r.isLegacyDemo && (
              <View className="bg-orange-100 rounded-xl p-3 mb-4">
                <Text className="text-sm text-orange-800">
                  {t("pay.receipt.legacy")}
                </Text>
              </View>
            )}
            <View className="bg-white rounded-2xl p-5">
              <View className="flex flex-row items-center justify-between">
                <StatusBadge status={r.outcome} />
                <Text className="text-xl font-JakartaBold">
                  {money(r.netChargedCents, r.currency)}
                </Text>
              </View>
              <Text className="text-lg font-JakartaBold mt-3">
                {t(`pay.receipt.outcome.${r.outcome}`)}
              </Text>
              <Text
                className="text-sm text-general-200 mt-2"
                accessibilityLiveRegion="polite"
              >
                {paymentText(r, i18n)}
              </Text>
              {(r.settlement === "retrying" ||
                r.settlement === "needs_review") && (
                <Text className="text-xs text-orange-800 mt-2">
                  {t("pay.receipt.slow")}
                </Text>
              )}
            </View>

            <View className="bg-white rounded-2xl px-5 py-3 mt-4">
              <Row label={t("pay.receipt.pickup")} value={r.pickup.address} />
              <Row
                label={t("pay.receipt.destination")}
                value={r.destination.address}
              />
              {r.driver && (
                <Row
                  label={t("pay.receipt.driver")}
                  value={`${r.driver.name} · ${r.driver.vehicle} · ${r.driver.plate}`}
                />
              )}
              {r.legacyDemoDriver && (
                <Row
                  label={t("pay.receipt.driver")}
                  value={t("pay.receipt.simulated", {
                    name: r.legacyDemoDriver,
                  })}
                />
              )}
              {r.requestedAt && (
                <Row
                  label={t("pay.receipt.requested")}
                  value={dateTime(r.requestedAt)}
                />
              )}
              {r.startedAt && (
                <Row
                  label={t("pay.receipt.pickedUp")}
                  value={dateTime(r.startedAt)}
                />
              )}
              {r.endedAt && (
                <Row
                  label={t("pay.receipt.ended")}
                  value={dateTime(r.endedAt)}
                />
              )}
              {r.rematchCount > 0 && (
                <Row
                  label={t("pay.receipt.reassigned")}
                  value={`${r.rematchCount}×`}
                />
              )}
            </View>

            <View className="bg-white rounded-2xl px-5 py-3 mt-4">
              <Row
                label={t("pay.receipt.quotedFare")}
                value={money(r.quotedFareCents, r.currency)}
              />
              <Row
                label={t("pay.receipt.charged")}
                value={money(r.chargedCents, r.currency)}
              />
              {r.refundedCents > 0 && (
                <Row
                  label={t("pay.receipt.refunded")}
                  value={`−${money(r.refundedCents, r.currency)}`}
                />
              )}
              {r.refundPendingCents > 0 && (
                <Row
                  label={t("pay.receipt.refundPending")}
                  value={money(r.refundPendingCents, r.currency)}
                />
              )}
              <Row
                label={t("pay.receipt.total")}
                value={`${money(r.netChargedCents, r.currency)} ${r.currency.toUpperCase()}`}
              />
              {r.tip && r.tip.status !== "canceled" && (
                <Row
                  label={t("pay.receipt.tip")}
                  value={`${t("pay.tip.line", {
                    amount: money(r.tip.amountCents, r.currency),
                    status: t(`pay.tip.status.${r.tip.status}`),
                  })}${
                    r.tip.refundedCents > 0
                      ? ` · ${t("pay.tip.refunded", { amount: money(r.tip.refundedCents, r.currency) })}`
                      : ""
                  }`}
                />
              )}
              {r.tip && r.tip.refundPendingCents > 0 && (
                <Row
                  label={t("pay.receipt.tipRefundPending")}
                  value={money(r.tip.refundPendingCents, r.currency)}
                />
              )}
              {r.disputes.map((dp, i) => (
                <Row
                  key={i}
                  label={
                    dp.subject === "tip"
                      ? t("pay.receipt.disputeTip")
                      : t("pay.receipt.disputeFare")
                  }
                  value={money(dp.amountCents, r.currency)}
                />
              ))}
            </View>

            {r.outcome === "completed" && (
              <RatingCard
                rideId={r.rideId}
                rating={r.rating}
                counterpart="driver"
              />
            )}

            {r.outcome === "completed" && !r.isLegacyDemo && (
              <TipSection rideId={r.rideId} />
            )}

            {(support.data ?? []).length > 0 && (
              <View className="bg-white rounded-2xl px-5 py-3 mt-4">
                <Text
                  className="text-base font-JakartaBold py-2"
                  accessibilityRole="header"
                >
                  {t("pay.receipt.reports")}
                </Text>
                {(support.data ?? []).map((s) => (
                  <View key={s.id} className="py-2 border-b border-general-700">
                    <View className="flex flex-row justify-between">
                      <Text className="text-sm font-JakartaSemiBold flex-1">
                        {isCategory(s.category)
                          ? t(`support.category.${s.category}`)
                          : t("support.request")}
                      </Text>
                      <Text className="text-sm text-general-200 ml-3">
                        {t(`support.status.${s.status}`)}
                      </Text>
                    </View>
                    <Text className="text-xs text-general-200 mt-1">
                      {t("pay.receipt.sent", { date: dateTime(s.createdAt) })}
                      {s.resolvedAt
                        ? ` · ${t("pay.receipt.resolved", { date: dateTime(s.resolvedAt) })}`
                        : ""}
                    </Text>
                    {s.resolutionMessage && (
                      <Text className="text-sm mt-2">
                        {s.resolutionMessage}
                      </Text>
                    )}
                    <Pressable
                      accessibilityRole="link"
                      className="min-h-[44px] justify-center"
                      onPress={() =>
                        router.push({
                          pathname: "/(root)/support/[id]",
                          params: { id: s.id },
                        })
                      }
                    >
                      <Text className="text-sm text-[#0066CC] font-JakartaSemiBold">
                        {t("pay.receipt.openConversation")}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {reportState && (
              <Text
                className={`text-sm mt-4 ${reportState.ok ? "text-green-700" : "text-red-600"}`}
                accessibilityLiveRegion="polite"
              >
                {reportState.text}
              </Text>
            )}

            {!r.isLegacyDemo && !reportOpen && (
              <CustomButton
                title={t("pay.receipt.report")}
                bgVariant="outline"
                textVariant="primary"
                className="mt-5"
                onPress={() => setReportOpen(true)}
              />
            )}

            {reportOpen && (
              <View className="bg-white rounded-2xl p-5 mt-5">
                <Text
                  className="text-base font-JakartaBold"
                  accessibilityRole="header"
                >
                  {t("pay.receipt.report")}
                </Text>
                <Text className="text-xs text-general-200 mt-1">
                  {t("pay.receipt.reportNote")}
                </Text>
                <View accessibilityRole="radiogroup">
                  {CATEGORIES.map((c) => (
                    <CustomButton
                      key={c}
                      title={t(`support.category.${c}`)}
                      bgVariant={category === c ? "primary" : "outline"}
                      textVariant={category === c ? "default" : "primary"}
                      className="mt-2"
                      accessibilityRole="radio"
                      accessibilityState={{ checked: category === c }}
                      onPress={() => setCategory(c)}
                    />
                  ))}
                </View>
                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  placeholder={t("pay.receipt.whatHappened")}
                  multiline
                  maxLength={1000}
                  className="border border-neutral-300 rounded-xl p-3 mt-3 min-h-[90px]"
                  accessibilityLabel={t("pay.receipt.describe")}
                />
                <CustomButton
                  title={
                    sending ? t("common.sending") : t("pay.receipt.sendReport")
                  }
                  disabled={sending || message.trim().length < 5}
                  className="mt-3"
                  onPress={report}
                />
                <CustomButton
                  title={t("common.cancel")}
                  bgVariant="outline"
                  textVariant="primary"
                  className="mt-2"
                  disabled={sending}
                  onPress={() => setReportOpen(false)}
                />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default ReceiptScreen;
