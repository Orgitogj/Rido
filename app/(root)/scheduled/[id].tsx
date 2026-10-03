import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
import ScheduledCard, { localLabel } from "@/components/ScheduledCard";
import ScreenHeader from "@/components/ScreenHeader";
import { useApi, useApiQuery } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
import { formatInZone } from "@/shared/zonedTime";
import { useLocationStore, useRideStore } from "@/store";

import type { ScheduledRideView } from "@/shared/schedule";

const REFRESH_MS = 20_000;

const Row = ({ label, value }: { label: string; value: string }) => (
  <View className="flex flex-row justify-between py-2 border-b border-general-700">
    <Text className="text-sm text-general-200">{label}</Text>
    <Text className="text-sm font-JakartaSemiBold ml-4 flex-shrink text-right">
      {value}
    </Text>
  </View>
);

const ScheduledDetail = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, tn, error: errorText, queryError } = useI18n();
  const request = useApi();
  const query = useApiQuery<ScheduledRideView>(`/api/scheduled-rides/${id}`, {
    refetchOnFocus: true,
  });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = query.data;
  const { refetch } = query;
  const open =
    item?.state === "scheduled" ||
    item?.state === "awaiting_confirmation" ||
    item?.state === "searching";

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(refetch, REFRESH_MS);
    return () => clearInterval(timer);
  }, [open, refetch]);

  const inZone = (iso: string, zone: string) =>
    localLabel(formatInZone(new Date(iso), zone) ?? iso);

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await request(`/api/scheduled-rides/${id}/cancel`, { method: "POST" });
      setConfirming(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      refetch();
    }
  };

  const confirm = () => {
    if (!item) return;
    useLocationStore.getState().setUserLocation(item.pickup);
    useLocationStore.getState().setDestinationLocation(item.destination);
    useLocationStore.getState().setStops(item.stops);
    useRideStore.getState().setCategory(item.category?.id ?? null);
    useRideStore.getState().setPassengerCount(item.passengerCount);
    useRideStore.getState().setScheduledRide(item.id);
    router.push("/(root)/confirm-ride");
  };

  const missing =
    query.status === "error" &&
    (query.errorCode === "NOT_FOUND" || query.errorCode === "INVALID_INPUT");

  return (
    <SafeAreaView className="flex-1 bg-general-500">
      <ScrollView
        className="px-5"
        contentContainerStyle={{ paddingBottom: 60 }}
      >
        <ScreenHeader
          title={t("schedule.title")}
          onBack={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/(root)/scheduled")
          }
        />

        {!item && query.status === "loading" && (
          <ListState kind="loading" message={t("common.loading")} />
        )}
        {!item && missing && (
          <ListState kind="empty" message={t("schedule.notFound")} />
        )}
        {!item && query.status === "error" && !missing && (
          <ListState
            kind="error"
            message={queryError(query)}
            onRetry={refetch}
          />
        )}

        {item && (
          <>
            <View className="bg-white rounded-2xl p-4">
              <ScheduledCard item={item} />
              <Text
                className="text-sm text-neutral-700 mt-3"
                accessibilityLiveRegion="polite"
              >
                {t(`schedule.stateHint.${item.state}`)}
              </Text>
              {item.endReason && (
                <Text className="text-sm text-general-200 mt-1">
                  {t(`schedule.endReason.${item.endReason}`)}
                </Text>
              )}
              {(item.state === "scheduled" ||
                item.state === "awaiting_confirmation") && (
                <Text className="text-xs text-general-200 mt-2">
                  {t("schedule.notReservation")}
                </Text>
              )}
            </View>

            <View className="bg-white rounded-2xl px-4 py-2 mt-3">
              <Row
                label={t("schedule.pickupAt")}
                value={`${localLabel(item.localTime)} (${item.timezone})`}
              />
              {(item.state === "scheduled" ||
                item.state === "awaiting_confirmation") && (
                <>
                  <Row
                    label={t("schedule.confirmFrom")}
                    value={inZone(item.confirmFrom, item.timezone)}
                  />
                  <Row
                    label={t("schedule.confirmBy")}
                    value={inZone(item.confirmBy, item.timezone)}
                  />
                </>
              )}
              <Row label={t("schedule.from")} value={item.pickup.address} />
              {item.stops.map((s, i) => (
                <Row
                  key={i}
                  label={t("booking.stops.number", { number: i + 1 })}
                  value={s.address}
                />
              ))}
              <Row label={t("schedule.to")} value={item.destination.address} />
              {item.category && (
                <Row label={t("schedule.vehicle")} value={item.category.name} />
              )}
              <Row
                label={t("booking.vehicle.passengers")}
                value={tn("schedule.passengers", item.passengerCount)}
              />
            </View>

            {error && (
              <Text
                className="text-sm text-red-600 mt-3"
                accessibilityLiveRegion="polite"
              >
                {error}
              </Text>
            )}

            {item.canConfirm && (
              <CustomButton
                title={t("schedule.confirmNow")}
                className="mt-4"
                onPress={confirm}
              />
            )}
            {item.rideId && (
              <CustomButton
                title={
                  item.state === "searching" || item.rideStatus === "accepted"
                    ? t("schedule.openRide")
                    : t("schedule.openReceipt")
                }
                bgVariant="outline"
                textVariant="primary"
                className="mt-3"
                onPress={() =>
                  router.push({
                    pathname:
                      item.state === "searching" ||
                      item.rideStatus === "accepted" ||
                      item.rideStatus === "arriving" ||
                      item.rideStatus === "arrived" ||
                      item.rideStatus === "in_progress"
                        ? "/(root)/ride/[id]"
                        : "/(root)/receipt/[id]",
                    params: { id: item.rideId! },
                  })
                }
              />
            )}

            {item.canCancel && !confirming && (
              <CustomButton
                title={t("schedule.cancel")}
                bgVariant="danger"
                className="mt-3"
                onPress={() => setConfirming(true)}
              />
            )}
            {item.canCancel && confirming && (
              <View
                className="bg-red-50 rounded-2xl p-4 mt-3"
                accessibilityRole="alert"
              >
                <Text className="text-sm">{t("schedule.cancelConfirm")}</Text>
                <CustomButton
                  title={
                    busy ? t("ride.busy.cancelling") : t("schedule.cancelYes")
                  }
                  bgVariant="danger"
                  className="mt-3"
                  disabled={busy}
                  onPress={cancel}
                />
                <CustomButton
                  title={t("schedule.cancelNo")}
                  bgVariant="outline"
                  textVariant="primary"
                  className="mt-2"
                  disabled={busy}
                  onPress={() => setConfirming(false)}
                />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default ScheduledDetail;
