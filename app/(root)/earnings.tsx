import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
import ScreenHeader from "@/components/ScreenHeader";
import { usePaged } from "@/lib/adminApi";
import { buildQuery } from "@/lib/adminFormat";
import {
  EARNINGS_PERIODS,
  type EarningsPeriod,
  formatRate,
  periodRange,
} from "@/lib/earningsText";
import { useApiQuery } from "@/lib/fetch";
import { type I18n, useI18n } from "@/lib/i18n";

import type { DriverEarningRide, EarningsSummary } from "@/shared/contracts";

const Row = ({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) => (
  <View className="flex flex-row justify-between py-1.5">
    <Text
      className={`text-sm flex-1 ${strong ? "font-JakartaBold" : "text-general-200"}`}
    >
      {label}
    </Text>
    <Text
      className={`text-sm ml-3 ${strong ? "font-JakartaBold" : "font-JakartaSemiBold"}`}
    >
      {value}
    </Text>
  </View>
);

const signed = (cents: number, money: I18n["money"]) =>
  cents < 0 ? `−${money(-cents)}` : money(cents);

const RideRow = ({ ride }: { ride: DriverEarningRide }) => {
  const { t, money, dateTime } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <View className="border-t border-general-700 py-3">
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="min-h-[44px] justify-center"
      >
        <View className="flex flex-row justify-between">
          <Text
            className="text-sm font-JakartaSemiBold flex-1"
            numberOfLines={1}
          >
            {ride.pickupAddress} → {ride.destinationAddress}
          </Text>
          <Text className="text-sm font-JakartaBold ml-3">
            {ride.state === "confirmed" ? signed(ride.netCents, money) : "—"}
          </Text>
        </View>
        <Text className="text-xs text-general-200 mt-1">
          {ride.completedAt ? `${dateTime(ride.completedAt)} · ` : ""}
          {t(`driver.earnings.rideState.${ride.state}`)}
          {ride.tip
            ? ` · ${ride.tip.status === "paid" ? t("driver.earnings.tipPaid") : t("driver.earnings.tipProcessing")}`
            : ""}
          {ride.disputeOpen ? ` · ${t("driver.earnings.disputed")}` : ""}
        </Text>
      </Pressable>
      {open && (
        <View className="bg-general-600 rounded-xl px-3 py-2 mt-2">
          <Row
            label={
              ride.state === "confirmed"
                ? t("driver.earnings.fareCaptured")
                : t("driver.earnings.quotedFare")
            }
            value={money(ride.fareCents)}
          />
          {ride.state === "confirmed" ? (
            <>
              <Row
                label={t("driver.earnings.commission", {
                  rate: formatRate(ride.commissionRateBps),
                  version: ride.policyVersion ?? "—",
                })}
                value={signed(-(ride.commissionCents ?? 0), money)}
              />
              <Row
                label={t("driver.earnings.yourShare")}
                value={money(ride.driverShareCents ?? 0)}
              />
            </>
          ) : (
            <Text className="text-xs text-general-200 py-1">
              {ride.state === "pending"
                ? t("driver.earnings.pendingRide")
                : t("driver.earnings.notCharged")}
            </Text>
          )}
          {ride.tip && (
            <Row
              label={
                ride.tip.status === "paid"
                  ? t("driver.earnings.tipLinePaid")
                  : t("driver.earnings.tipLineProcessing")
              }
              value={money(ride.tip.amountCents)}
            />
          )}
          {ride.entries
            .filter((e) => e.kind !== "ride_earning" && e.kind !== "tip")
            .map((e, i) => (
              <Row
                key={i}
                label={`${t(`driver.earnings.entry.${e.kind}`)} · ${dateTime(e.occurredAt)}`}
                value={signed(e.driverAmountCents, money)}
              />
            ))}
          <Row
            label={t("driver.earnings.netRide")}
            value={signed(ride.netCents, money)}
            strong
          />
        </View>
      )}
    </View>
  );
};

const EarningsScreen = () => {
  const { t, tn, language, queryError, money } = useI18n();
  const [period, setPeriod] = useState<EarningsPeriod>("week");
  const range = useMemo(() => periodRange(period, new Date()), [period]);
  const summary = useApiQuery<EarningsSummary>(
    `/api/driver/earnings/summary${buildQuery(range)}`,
    { refetchOnFocus: true },
  );
  const rides = usePaged<DriverEarningRide>("/api/driver/earnings", range);
  const s = summary.data;

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <ScrollView
        className="px-5"
        contentContainerStyle={{ paddingBottom: 60 }}
      >
        <ScreenHeader
          title={t("driver.earnings.title")}
          onBack={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/(root)/driver")
          }
        />

        <View className="flex flex-row flex-wrap" accessibilityRole="tablist">
          {EARNINGS_PERIODS.map((p) => (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              accessibilityRole="tab"
              accessibilityState={{ selected: period === p }}
              className={`px-4 min-h-[44px] justify-center rounded-full mr-2 mb-2 border ${period === p ? "bg-[#0066CC] border-[#0066CC]" : "bg-white border-neutral-400"}`}
            >
              <Text
                className={`text-sm ${period === p ? "text-white" : "text-neutral-700"}`}
              >
                {t(`driver.earnings.period.${p}`)}
              </Text>
            </Pressable>
          ))}
        </View>

        {!s && summary.status === "loading" && (
          <ListState kind="loading" message={t("driver.earnings.loading")} />
        )}
        {!s && summary.status === "error" && (
          <ListState
            kind="error"
            message={queryError(summary)}
            onRetry={summary.refetch}
          />
        )}

        {s && (
          <>
            <View className="bg-white rounded-2xl p-5 mt-2">
              <Text className="text-sm text-general-200">
                {t("driver.earnings.confirmed", {
                  period: t(`driver.earnings.period.${period}`),
                })}
              </Text>
              <Text className="text-3xl font-JakartaExtraBold mt-1">
                {signed(s.confirmed.netCents, money)}
              </Text>
              <View className="mt-3">
                <Row
                  label={t("driver.earnings.completedRides")}
                  value={String(s.confirmed.rides)}
                />
                <Row
                  label={t("driver.earnings.faresCaptured")}
                  value={money(s.confirmed.fareCents)}
                />
                <Row
                  label={t("driver.earnings.commissionNow", {
                    rate: formatRate(s.policy.fareCommissionBps),
                  })}
                  value={signed(-s.confirmed.commissionCents, money)}
                />
                <Row
                  label={t("driver.earnings.fareShare")}
                  value={money(s.confirmed.driverShareCents)}
                />
                <Row
                  label={t("driver.earnings.tips")}
                  value={money(s.confirmed.tipsCents)}
                />
                <Row
                  label={t("driver.earnings.refundAdjustments")}
                  value={signed(s.confirmed.adjustmentsCents, money)}
                />
                <Row
                  label={t("driver.earnings.disputes")}
                  value={signed(s.confirmed.disputesCents, money)}
                />
                <Row
                  label={t("driver.earnings.net")}
                  value={signed(s.confirmed.netCents, money)}
                  strong
                />
              </View>
            </View>

            <View className="bg-white rounded-2xl p-4 mt-4">
              <Text className="text-sm font-JakartaSemiBold">
                {t("driver.earnings.noPayoutsTitle")}
              </Text>
              <Text className="text-xs text-general-200 mt-1">
                {t("driver.earnings.noPayoutsBody")}
              </Text>
              <Text className="text-xs text-general-200 mt-2">
                {language === "en"
                  ? s.policy.label
                  : t("driver.earnings.policy", { version: s.policy.version })}
              </Text>
            </View>

            {s.disputes.open > 0 && (
              <View className="bg-red-50 rounded-2xl p-5 mt-4">
                <Text className="text-base font-JakartaBold text-red-700">
                  {tn("driver.earnings.disputesOpen", s.disputes.open)}
                </Text>
                <Text className="text-xs text-red-700 mt-1">
                  {t("driver.earnings.disputesBody")}
                </Text>
              </View>
            )}

            {(s.pending.rides > 0 || s.pending.tips > 0) && (
              <View className="bg-orange-50 rounded-2xl p-5 mt-4">
                <Text className="text-base font-JakartaBold text-orange-800">
                  {t("driver.earnings.pendingTitle")}
                </Text>
                {s.pending.rides > 0 && (
                  <Text className="text-sm text-orange-800 mt-1">
                    {tn("driver.earnings.pendingRides", s.pending.rides, {
                      amount: money(s.pending.fareCents),
                    })}
                  </Text>
                )}
                {s.pending.tips > 0 && (
                  <Text className="text-sm text-orange-800 mt-1">
                    {tn("driver.earnings.pendingTips", s.pending.tips, {
                      amount: money(s.pending.tipsCents),
                    })}
                  </Text>
                )}
                <Text className="text-xs text-orange-800 mt-2">
                  {t("driver.earnings.pendingNote")}
                </Text>
              </View>
            )}
          </>
        )}

        <View className="bg-white rounded-2xl px-5 py-3 mt-4">
          <Text
            className="text-lg font-JakartaBold py-2"
            accessibilityRole="header"
          >
            {t("driver.earnings.ridesTitle")}
          </Text>
          {rides.status === "error" && rides.error && (
            <Text className="text-sm text-red-600">
              {queryError({ error: rides.error })}
            </Text>
          )}
          {rides.status === "ready" && rides.items.length === 0 && (
            <Text className="text-sm text-general-200 pb-2">
              {t("driver.earnings.noRides")}
            </Text>
          )}
          {rides.items.map((ride) => (
            <RideRow key={ride.rideId} ride={ride} />
          ))}
          {rides.hasMore && (
            <CustomButton
              title={
                rides.status === "loading"
                  ? t("common.loading")
                  : t("common.loadMore")
              }
              bgVariant="outline"
              textVariant="primary"
              className="mt-3"
              disabled={rides.status === "loading"}
              onPress={rides.loadMore}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default EarningsScreen;
