import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
import { usePaged } from "@/lib/adminApi";
import { buildQuery } from "@/lib/adminFormat";
import {
  ENTRY_LABEL,
  type EarningsPeriod,
  formatRate,
  PERIOD_LABEL,
  periodRange,
  RIDE_STATE_LABEL,
} from "@/lib/earningsText";
import { useApiQuery } from "@/lib/fetch";
import { formatCents, formatDate } from "@/lib/utils";

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
      className={`text-sm ${strong ? "font-JakartaBold" : "text-general-200"}`}
    >
      {label}
    </Text>
    <Text
      className={`text-sm ${strong ? "font-JakartaBold" : "font-JakartaSemiBold"}`}
    >
      {value}
    </Text>
  </View>
);

const signed = (cents: number) =>
  cents < 0 ? `−${formatCents(-cents)}` : formatCents(cents);

const RideRow = ({ ride }: { ride: DriverEarningRide }) => {
  const [open, setOpen] = useState(false);
  return (
    <View className="border-t border-general-700 py-3">
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View className="flex flex-row justify-between">
          <Text
            className="text-sm font-JakartaSemiBold flex-1"
            numberOfLines={1}
          >
            {ride.pickupAddress} → {ride.destinationAddress}
          </Text>
          <Text className="text-sm font-JakartaBold ml-3">
            {ride.state === "confirmed" ? signed(ride.netCents) : "—"}
          </Text>
        </View>
        <Text className="text-xs text-general-200 mt-1">
          {ride.completedAt ? formatDate(ride.completedAt) : ""} ·{" "}
          {RIDE_STATE_LABEL[ride.state]}
          {ride.tip ? ` · tip ${ride.tip.status}` : ""}
          {ride.disputeOpen ? " · payment disputed" : ""}
        </Text>
      </Pressable>
      {open && (
        <View className="bg-general-600 rounded-xl px-3 py-2 mt-2">
          <Row
            label={ride.state === "confirmed" ? "Fare captured" : "Quoted fare"}
            value={formatCents(ride.fareCents)}
          />
          {ride.state === "confirmed" ? (
            <>
              <Row
                label={`Platform commission (${formatRate(ride.commissionRateBps)}, policy ${ride.policyVersion})`}
                value={signed(-(ride.commissionCents ?? 0))}
              />
              <Row
                label="Your share"
                value={formatCents(ride.driverShareCents ?? 0)}
              />
            </>
          ) : (
            <Text className="text-xs text-general-200 py-1">
              {ride.state === "pending"
                ? "Not counted yet: the passenger's payment hasn't been confirmed by the card processor."
                : "This fare was not charged, so nothing was earned."}
            </Text>
          )}
          {ride.tip && (
            <Row
              label={`Tip (${ride.tip.status === "paid" ? "paid" : "processing, not counted yet"})`}
              value={formatCents(ride.tip.amountCents)}
            />
          )}
          {ride.entries
            .filter((e) => e.kind !== "ride_earning" && e.kind !== "tip")
            .map((e, i) => (
              <Row
                key={i}
                label={`${ENTRY_LABEL[e.kind]} · ${formatDate(e.occurredAt)}`}
                value={signed(e.driverAmountCents)}
              />
            ))}
          <Row label="Net for this ride" value={signed(ride.netCents)} strong />
        </View>
      )}
    </View>
  );
};

const EarningsScreen = () => {
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
        <View className="flex flex-row items-center justify-between my-5">
          <Text className="text-2xl font-JakartaExtraBold">Earnings</Text>
          <CustomButton
            title="Back"
            bgVariant="outline"
            textVariant="primary"
            className="w-24"
            onPress={() =>
              router.canGoBack()
                ? router.back()
                : router.replace("/(root)/driver")
            }
          />
        </View>

        <View className="flex flex-row flex-wrap">
          {(Object.keys(PERIOD_LABEL) as EarningsPeriod[]).map((p) => (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              accessibilityRole="button"
              accessibilityState={{ selected: period === p }}
              className={`px-3 py-1.5 rounded-full mr-2 mb-2 border ${period === p ? "bg-[#0286FF] border-[#0286FF]" : "bg-white border-neutral-300"}`}
            >
              <Text
                className={`text-xs ${period === p ? "text-white" : "text-neutral-700"}`}
              >
                {PERIOD_LABEL[p]}
              </Text>
            </Pressable>
          ))}
        </View>

        {!s && summary.status === "loading" && (
          <ListState kind="loading" message="Loading earnings…" />
        )}
        {!s && summary.status === "error" && (
          <ListState
            kind="error"
            message={summary.error}
            onRetry={summary.refetch}
          />
        )}

        {s && (
          <>
            <View className="bg-white rounded-2xl p-5 mt-2">
              <Text className="text-sm text-general-200">
                Confirmed earnings · {PERIOD_LABEL[period]}
              </Text>
              <Text className="text-3xl font-JakartaExtraBold mt-1">
                {signed(s.confirmed.netCents)}
              </Text>
              <View className="mt-3">
                <Row
                  label="Completed rides"
                  value={String(s.confirmed.rides)}
                />
                <Row
                  label="Fares captured"
                  value={formatCents(s.confirmed.fareCents)}
                />
                <Row
                  label={`Platform commission (${formatRate(s.policy.fareCommissionBps)} now)`}
                  value={signed(-s.confirmed.commissionCents)}
                />
                <Row
                  label="Your fare share"
                  value={formatCents(s.confirmed.driverShareCents)}
                />
                <Row label="Tips" value={formatCents(s.confirmed.tipsCents)} />
                <Row
                  label="Refund adjustments"
                  value={signed(s.confirmed.adjustmentsCents)}
                />
                <Row
                  label="Payment disputes"
                  value={signed(s.confirmed.disputesCents)}
                />
                <Row
                  label="Net earned"
                  value={signed(s.confirmed.netCents)}
                  strong
                />
              </View>
            </View>

            {s.disputes.open > 0 && (
              <View className="bg-red-50 rounded-2xl p-5 mt-4">
                <Text className="text-base font-JakartaBold text-red-700">
                  {s.disputes.open} payment dispute
                  {s.disputes.open === 1 ? "" : "s"} open
                </Text>
                <Text className="text-xs text-red-700 mt-1">
                  A passenger&apos;s bank is disputing a charge. Funds the card
                  network withdraws are shown as separate lines and are added
                  back if the dispute is won.
                </Text>
              </View>
            )}

            {(s.pending.rides > 0 || s.pending.tips > 0) && (
              <View className="bg-orange-50 rounded-2xl p-5 mt-4">
                <Text className="text-base font-JakartaBold text-orange-700">
                  Awaiting payment confirmation
                </Text>
                {s.pending.rides > 0 && (
                  <Text className="text-sm text-orange-700 mt-1">
                    {s.pending.rides} ride{s.pending.rides === 1 ? "" : "s"} ·{" "}
                    {formatCents(s.pending.fareCents)} in fares
                  </Text>
                )}
                {s.pending.tips > 0 && (
                  <Text className="text-sm text-orange-700 mt-1">
                    {s.pending.tips} tip{s.pending.tips === 1 ? "" : "s"} ·{" "}
                    {formatCents(s.pending.tipsCents)} processing
                  </Text>
                )}
                <Text className="text-xs text-orange-700 mt-2">
                  These aren&apos;t included above until the card processor
                  confirms the payment.
                </Text>
              </View>
            )}

            <View className="bg-white rounded-2xl p-4 mt-4">
              <Text className="text-sm font-JakartaSemiBold">
                No payouts yet
              </Text>
              <Text className="text-xs text-general-200 mt-1">
                {s.payouts.message}
              </Text>
              <Text className="text-xs text-general-200 mt-2">
                {s.policy.label}
              </Text>
            </View>
          </>
        )}

        <View className="bg-white rounded-2xl px-5 py-3 mt-4">
          <Text className="text-lg font-JakartaBold py-2">Completed rides</Text>
          {rides.status === "error" && rides.error && (
            <Text className="text-sm text-red-500">{rides.error}</Text>
          )}
          {rides.status === "ready" && rides.items.length === 0 && (
            <Text className="text-sm text-general-200 pb-2">
              No completed rides in this period.
            </Text>
          )}
          {rides.items.map((ride) => (
            <RideRow key={ride.rideId} ride={ride} />
          ))}
          {rides.hasMore && (
            <CustomButton
              title={rides.status === "loading" ? "Loading…" : "Load more"}
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
