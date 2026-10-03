import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
import ScreenHeader from "@/components/ScreenHeader";
import { ApiRequestError, useApi, useApiQuery } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
import {
  addMinutesToLocal,
  joinLocal,
  nextDayAt,
  roundUpLocal,
  splitLocal,
} from "@/lib/itinerary";
import { usePushStatus } from "@/lib/notifications";
import { newClientId } from "@/lib/places";
import { SCHEDULE_RULES } from "@/shared/schedule";
import { parseLocalTime } from "@/shared/zonedTime";
import { useLocationStore, useRideStore } from "@/store";

import type { ScheduleAreaInfo, ScheduledRideView } from "@/shared/schedule";

const ScheduleRide = () => {
  const { t, error: errorText, queryError } = useI18n();
  const request = useApi();
  const {
    userAddress,
    userLatitude,
    userLongitude,
    destinationAddress,
    destinationLatitude,
    destinationLongitude,
    stops,
  } = useLocationStore();
  const { categoryId, passengerCount } = useRideStore();
  const pushStatus = usePushStatus((s) => s.status);
  const ready =
    userLatitude !== null &&
    userLongitude !== null &&
    destinationLatitude !== null &&
    destinationLongitude !== null &&
    Boolean(userAddress) &&
    Boolean(destinationAddress);
  const window = useApiQuery<ScheduleAreaInfo>(
    ready
      ? `/api/scheduled-rides/window?latitude=${userLatitude}&longitude=${userLongitude}`
      : null,
  );
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const clientRequestId = useRef(newClientId());
  const info = window.data;

  useEffect(() => {
    if (!info || date || time) return;
    const start = roundUpLocal(
      addMinutesToLocal(info.earliestLocal, 30) ?? info.earliestLocal,
      15,
    );
    if (start) {
      const parts = splitLocal(start);
      setDate(parts.date);
      setTime(parts.time);
    }
  }, [info, date, time]);

  const local = joinLocal(date, time);
  const valid = parseLocalTime(local) !== null;

  const choose = (value: string | null) => {
    if (!value) return;
    const parts = splitLocal(value);
    setDate(parts.date);
    setTime(parts.time);
    setAmbiguous(false);
    setError(null);
  };

  const submit = async (fold?: "earlier" | "later") => {
    if (!ready || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await request<ScheduledRideView>("/api/scheduled-rides", {
        body: {
          pickup: {
            address: userAddress,
            latitude: userLatitude,
            longitude: userLongitude,
          },
          destination: {
            address: destinationAddress,
            latitude: destinationLatitude,
            longitude: destinationLongitude,
          },
          ...(stops.length ? { stops } : {}),
          ...(categoryId ? { categoryId } : {}),
          passengerCount,
          localTime: local,
          ...(fold ? { fold } : {}),
          clientRequestId: clientRequestId.current,
        },
      });
      router.replace({
        pathname: "/(root)/scheduled/[id]",
        params: { id: created.id },
      });
    } catch (e) {
      if (
        e instanceof ApiRequestError &&
        e.code === "SCHEDULE_TIME_AMBIGUOUS"
      ) {
        setAmbiguous(true);
      } else {
        setError(errorText(e));
      }
    } finally {
      setBusy(false);
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
          <ScreenHeader title={t("schedule.newTitle")} />

          {!ready && (
            <ListState
              kind="empty"
              message={t("booking.confirm.missing")}
              onRetry={() => router.back()}
            />
          )}
          {ready && window.status === "loading" && !info && (
            <ListState kind="loading" message={t("common.loading")} />
          )}
          {ready && window.status === "error" && !info && (
            <ListState
              kind="error"
              message={queryError(window)}
              onRetry={window.refetch}
            />
          )}

          {ready && info && (
            <>
              <View className="bg-white rounded-2xl p-4">
                <Text className="text-sm font-JakartaBold">
                  {t("schedule.notReservation")}
                </Text>
                <Text className="text-sm text-neutral-700 mt-2">
                  {t("schedule.howItWorks", {
                    lead: SCHEDULE_RULES.confirmLeadMinutes,
                    grace: SCHEDULE_RULES.confirmGraceMinutes,
                  })}
                </Text>
                <Text className="text-xs text-general-200 mt-2">
                  {t("schedule.noPriceYet")}
                </Text>
                {pushStatus !== "registered" && (
                  <Text className="text-xs text-orange-800 mt-2">
                    {t("schedule.pushHint")}
                  </Text>
                )}
              </View>

              <View className="bg-white rounded-2xl p-4 mt-3">
                <Text className="text-xs text-general-200">
                  {t("schedule.from")}
                </Text>
                <Text className="text-sm font-JakartaMedium">
                  {userAddress}
                </Text>
                {stops.map((s, i) => (
                  <Text key={i} className="text-sm mt-1">
                    {t("booking.stops.number", { number: i + 1 })}: {s.address}
                  </Text>
                ))}
                <Text className="text-xs text-general-200 mt-2">
                  {t("schedule.to")}
                </Text>
                <Text className="text-sm font-JakartaMedium">
                  {destinationAddress}
                </Text>
              </View>

              <View className="bg-white rounded-2xl p-4 mt-3">
                <View className="flex flex-row">
                  <View className="flex-1 mr-3">
                    <Text className="text-xs text-general-200 mb-1">
                      {t("schedule.date")}
                    </Text>
                    <TextInput
                      value={date}
                      onChangeText={(v) => {
                        setDate(v);
                        setAmbiguous(false);
                      }}
                      placeholder={t("schedule.dateHint")}
                      placeholderTextColor="#8a8a8a"
                      keyboardType="numbers-and-punctuation"
                      maxLength={10}
                      accessibilityLabel={`${t("schedule.date")}. ${t("schedule.dateHint")}`}
                      className="bg-neutral-100 rounded-xl px-3 min-h-[44px] text-base"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-xs text-general-200 mb-1">
                      {t("schedule.time")}
                    </Text>
                    <TextInput
                      value={time}
                      onChangeText={(v) => {
                        setTime(v);
                        setAmbiguous(false);
                      }}
                      placeholder="HH:MM"
                      placeholderTextColor="#8a8a8a"
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                      accessibilityLabel={`${t("schedule.time")}. ${t("schedule.timeHint")}`}
                      className="bg-neutral-100 rounded-xl px-3 min-h-[44px] text-base"
                    />
                  </View>
                </View>
                <View className="flex flex-row flex-wrap mt-2">
                  {(
                    [
                      ["inOneHour", addMinutesToLocal(info.localNow, 60)],
                      ["inTwoHours", addMinutesToLocal(info.localNow, 120)],
                      ["tomorrowMorning", nextDayAt(info.localNow, "08:00")],
                    ] as const
                  ).map(([key, value]) => (
                    <TouchableOpacity
                      key={key}
                      onPress={() =>
                        choose(value ? roundUpLocal(value, 5) : null)
                      }
                      accessibilityRole="button"
                      className="px-3 min-h-[44px] justify-center rounded-full border border-neutral-400 mr-2 mb-2"
                    >
                      <Text className="text-sm">
                        {t(`schedule.quick.${key}`)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text className="text-xs text-general-200">
                  {t("schedule.timezone", { timezone: info.timezone })}
                </Text>
                <Text className="text-xs text-general-200 mt-1">
                  {t("schedule.window", {
                    earliest: info.earliestLocal.replace("T", " "),
                    latest: info.latestLocal.replace("T", " "),
                  })}
                </Text>
                {!valid && (date !== "" || time !== "") && (
                  <Text
                    className="text-sm text-red-600 mt-2"
                    accessibilityLiveRegion="polite"
                  >
                    {t("schedule.invalid")}
                  </Text>
                )}
              </View>

              {ambiguous && (
                <View
                  className="bg-orange-50 rounded-2xl p-4 mt-3"
                  accessibilityRole="alert"
                >
                  <Text className="text-base font-JakartaBold">
                    {t("schedule.ambiguousTitle")}
                  </Text>
                  <Text className="text-sm mt-1">
                    {t("schedule.ambiguousBody")}
                  </Text>
                  <CustomButton
                    title={t("schedule.earlier")}
                    className="mt-3"
                    disabled={busy}
                    onPress={() => submit("earlier")}
                  />
                  <CustomButton
                    title={t("schedule.later")}
                    bgVariant="outline"
                    textVariant="primary"
                    className="mt-2"
                    disabled={busy}
                    onPress={() => submit("later")}
                  />
                </View>
              )}

              {error && (
                <Text
                  className="text-sm text-red-600 mt-3"
                  accessibilityLiveRegion="polite"
                >
                  {error}
                </Text>
              )}
              {!ambiguous && (
                <CustomButton
                  title={busy ? t("schedule.scheduling") : t("schedule.submit")}
                  className="mt-4"
                  disabled={busy || !valid}
                  onPress={() => submit()}
                />
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default ScheduleRide;
