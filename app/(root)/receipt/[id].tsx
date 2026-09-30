import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
import RatingCard from "@/components/RatingCard";
import StatusBadge from "@/components/StatusBadge";
import TipSection from "@/components/TipSection";
import { TIP_STATUS_TEXT } from "@/lib/earningsText";
import { ApiRequestError, useApi, useApiQuery } from "@/lib/fetch";
import { formatCents, formatDate } from "@/lib/utils";

import type { PassengerSupportRequest, Receipt } from "@/shared/contracts";

const PENDING = ["hold_releasing", "charge_pending", "hold_active"];

const CATEGORIES = [
  { value: "charge_question", label: "Question about the charge" },
  { value: "trip_problem", label: "Problem with the trip" },
  { value: "driver_issue", label: "Issue with the driver" },
  { value: "other", label: "Something else" },
] as const;

const SUPPORT_STATUS: Record<PassengerSupportRequest["status"], string> = {
  open: "Received",
  in_progress: "Being reviewed",
  resolved: "Resolved",
};

const categoryLabel = (value: string) =>
  CATEGORIES.find((c) => c.value === value)?.label ?? "Report";

const Row = ({ label, value }: { label: string; value: string }) => (
  <View className="flex flex-row justify-between py-2 border-b border-general-700">
    <Text className="text-sm text-general-200">{label}</Text>
    <Text className="text-sm font-JakartaSemiBold ml-4 flex-shrink text-right">
      {value}
    </Text>
  </View>
);

const ReceiptScreen = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const request = useApi();
  const receipt = useApiQuery<Receipt>(`/api/receipts/${id}`, {
    refetchOnFocus: true,
  });
  const support = useApiQuery<PassengerSupportRequest[]>(
    `/api/rides/${id}/support`,
    { refetchOnFocus: true },
  );
  const [category, setCategory] =
    useState<(typeof CATEGORIES)[number]["value"]>("charge_question");
  const [message, setMessage] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportState, setReportState] = useState<string | null>(null);
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
      const res = await request<{ message: string }>(
        `/api/rides/${id}/support`,
        { body: { category, message } },
      );
      setReportState(res.message);
      setReportOpen(false);
      setMessage("");
      support.refetch();
    } catch (e) {
      setReportState(
        e instanceof ApiRequestError ? e.message : "Couldn't send your report.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <ScrollView
        className="px-5"
        contentContainerStyle={{ paddingBottom: 60 }}
      >
        <View className="flex flex-row items-center justify-between my-5">
          <Text className="text-2xl font-JakartaExtraBold">Receipt</Text>
          <CustomButton
            title="Close"
            bgVariant="outline"
            textVariant="primary"
            className="w-28"
            onPress={() =>
              router.canGoBack()
                ? router.back()
                : router.replace("/(root)/(tabs)/rides")
            }
          />
        </View>

        {!r && receipt.status === "loading" && (
          <ListState kind="loading" message="Loading receipt…" />
        )}
        {!r && receipt.status === "error" && (
          <ListState kind="error" message={receipt.error} onRetry={refetch} />
        )}

        {r && (
          <>
            {r.isLegacyDemo && (
              <View className="bg-orange-100 rounded-xl p-3 mb-4">
                <Text className="text-sm text-orange-700">
                  Demo booking from the earlier version of the app, with a
                  simulated driver. No real trip took place.
                </Text>
              </View>
            )}
            <View className="bg-white rounded-2xl p-5">
              <View className="flex flex-row items-center justify-between">
                <StatusBadge status={r.outcome} />
                <Text className="text-xl font-JakartaBold">
                  {formatCents(r.netChargedCents)}
                </Text>
              </View>
              <Text className="text-lg font-JakartaBold mt-3">
                {r.outcomeText}
              </Text>
              <Text
                className="text-sm text-general-200 mt-2"
                accessibilityLiveRegion="polite"
              >
                {r.paymentText}
              </Text>
              {(r.settlement === "retrying" ||
                r.settlement === "needs_review") && (
                <Text className="text-xs text-orange-700 mt-2">
                  Our payment provider hasn't confirmed this yet. We retry
                  automatically; this page updates when it's done.
                </Text>
              )}
            </View>

            <View className="bg-white rounded-2xl px-5 py-3 mt-4">
              <Row label="Pickup" value={r.pickup.address} />
              <Row label="Destination" value={r.destination.address} />
              {r.driver && (
                <Row
                  label="Driver"
                  value={`${r.driver.name} · ${r.driver.vehicle} · ${r.driver.plate}`}
                />
              )}
              {r.legacyDemoDriver && (
                <Row
                  label="Driver"
                  value={`${r.legacyDemoDriver} (simulated)`}
                />
              )}
              {r.requestedAt && (
                <Row label="Requested" value={formatDate(r.requestedAt)} />
              )}
              {r.startedAt && (
                <Row label="Picked up" value={formatDate(r.startedAt)} />
              )}
              {r.endedAt && <Row label="Ended" value={formatDate(r.endedAt)} />}
              {r.rematchCount > 0 && (
                <Row label="Driver reassigned" value={`${r.rematchCount}×`} />
              )}
            </View>

            <View className="bg-white rounded-2xl px-5 py-3 mt-4">
              <Row label="Quoted fare" value={formatCents(r.quotedFareCents)} />
              <Row label="Charged" value={formatCents(r.chargedCents)} />
              {r.refundedCents > 0 && (
                <Row
                  label="Refunded"
                  value={`−${formatCents(r.refundedCents)}`}
                />
              )}
              {r.refundPendingCents > 0 && (
                <Row
                  label="Refund pending"
                  value={formatCents(r.refundPendingCents)}
                />
              )}
              <Row
                label="Total"
                value={`${formatCents(r.netChargedCents)} USD`}
              />
              {r.tip && r.tip.status !== "canceled" && (
                <Row
                  label="Tip (separate charge)"
                  value={`${formatCents(r.tip.amountCents)} · ${TIP_STATUS_TEXT[r.tip.status]}${r.tip.refundedCents > 0 ? ` · ${formatCents(r.tip.refundedCents)} refunded` : ""}`}
                />
              )}
              {r.tip && r.tip.refundPendingCents > 0 && (
                <Row
                  label="Tip refund pending"
                  value={formatCents(r.tip.refundPendingCents)}
                />
              )}
              {r.disputes.map((dp, i) => (
                <Row
                  key={i}
                  label={`${dp.subject === "tip" ? "Tip" : "Fare"} disputed with your bank`}
                  value={`${formatCents(dp.amountCents)} · ${dp.status.replace(/_/g, " ")}`}
                />
              ))}
            </View>

            {r.outcome === "completed" && (
              <RatingCard
                rideId={r.rideId}
                rating={r.rating}
                counterpart="your driver"
              />
            )}

            {r.outcome === "completed" && !r.isLegacyDemo && (
              <TipSection rideId={r.rideId} />
            )}

            {(support.data ?? []).length > 0 && (
              <View className="bg-white rounded-2xl px-5 py-3 mt-4">
                <Text className="text-base font-JakartaBold py-2">
                  Your reports
                </Text>
                {(support.data ?? []).map((s) => (
                  <View key={s.id} className="py-2 border-b border-general-700">
                    <View className="flex flex-row justify-between">
                      <Text className="text-sm font-JakartaSemiBold">
                        {categoryLabel(s.category)}
                      </Text>
                      <Text className="text-sm text-general-200">
                        {SUPPORT_STATUS[s.status]}
                      </Text>
                    </View>
                    <Text className="text-xs text-general-200 mt-1">
                      Sent {formatDate(s.createdAt)}
                      {s.resolvedAt
                        ? ` · resolved ${formatDate(s.resolvedAt)}`
                        : ""}
                    </Text>
                    {s.resolutionMessage && (
                      <Text className="text-sm mt-2">
                        {s.resolutionMessage}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            {reportState && (
              <Text className="text-sm text-general-200 mt-4">
                {reportState}
              </Text>
            )}

            {!r.isLegacyDemo && !reportOpen && (
              <CustomButton
                title="Report a problem"
                bgVariant="outline"
                textVariant="primary"
                className="mt-5"
                onPress={() => setReportOpen(true)}
              />
            )}

            {reportOpen && (
              <View className="bg-white rounded-2xl p-5 mt-5">
                <Text className="text-base font-JakartaBold">
                  Report a problem
                </Text>
                <Text className="text-xs text-general-200 mt-1">
                  Support reviews every report. Refunds, if any, are decided by
                  support and appear on this receipt once processed.
                </Text>
                {CATEGORIES.map((c) => (
                  <CustomButton
                    key={c.value}
                    title={c.label}
                    bgVariant={category === c.value ? "primary" : "outline"}
                    textVariant={category === c.value ? "default" : "primary"}
                    className="mt-2"
                    onPress={() => setCategory(c.value)}
                  />
                ))}
                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  placeholder="What happened?"
                  multiline
                  maxLength={1000}
                  className="border border-neutral-200 rounded-xl p-3 mt-3 min-h-[90px]"
                  accessibilityLabel="Describe the problem"
                />
                <CustomButton
                  title={sending ? "Sending…" : "Send report"}
                  disabled={sending || message.trim().length < 5}
                  className="mt-3"
                  onPress={report}
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
