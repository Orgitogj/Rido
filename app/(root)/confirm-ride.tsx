import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
import RequestRide from "@/components/RequestRide";
import RideLayout from "@/components/RideLayout";
import StripeCheckout from "@/components/StripeCheckout";
import { ApiRequestError, useApi } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
import { matchingPlace, usePlacesStore } from "@/lib/places";
import {
  coverageProblem,
  type QuoteProblem,
  quoteProblem,
  secondsUntil,
} from "@/lib/quoteErrors";
import { useLocationStore, useRideStore } from "@/store";

import type { QuoteResponse } from "@/shared/contracts";
import type { PaymentMethod } from "@/shared/currency";

type Status = "loading" | "ready" | "expired" | "error";

const Line = ({
  label,
  value,
  strong,
  last,
}: {
  label: string;
  value: string;
  strong?: boolean;
  last?: boolean;
}) => (
  <View
    className={`flex flex-row items-center justify-between w-full py-3 ${last ? "" : "border-b border-white"}`}
  >
    <Text className="text-lg font-Jakarta flex-1">{label}</Text>
    <Text
      className={`text-lg ml-3 ${strong ? "font-JakartaBold text-green-700" : "font-Jakarta"}`}
    >
      {value}
    </Text>
  </View>
);

const ConfirmRide = () => {
  const { t, tn, language, money, km, duration } = useI18n();
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
  const {
    quote,
    driversNearby,
    categoryId,
    passengerCount,
    scheduledRideId,
    setQuote,
    setScheduledRide,
    clear,
  } = useRideStore();
  const savedPlaces = usePlacesStore((s) => s.places);
  const [status, setStatus] = useState<Status>("loading");
  const [problem, setProblem] = useState<QuoteProblem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("in_vehicle");
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef(0);
  const previousFare = useRef<number | null>(null);

  const loadQuote = useCallback(async () => {
    if (
      userLatitude === null ||
      userLongitude === null ||
      destinationLatitude === null ||
      destinationLongitude === null ||
      !userAddress ||
      !destinationAddress
    ) {
      setProblem({
        ...quoteProblem(null, t("booking.confirm.missing"), language),
        message: t("booking.confirm.missing"),
        retry: false,
        changeLocations: true,
      });
      setStatus("error");
      return;
    }
    const id = ++latest.current;
    setStatus("loading");
    setNotice(null);
    try {
      const result = scheduledRideId
        ? await request<QuoteResponse>(
            `/api/scheduled-rides/${scheduledRideId}/quote`,
            { method: "POST" },
          )
        : await request<QuoteResponse>("/api/quotes", {
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
            },
          });
      if (id !== latest.current) return;
      const before = previousFare.current;
      if (before !== null) {
        setNotice(
          before === result.quote.fareCents
            ? t("booking.confirm.priceSame")
            : t("booking.confirm.priceChanged", {
                previous: money(before, result.quote.currency),
                current: money(result.quote.fareCents, result.quote.currency),
              }),
        );
      }
      previousFare.current = result.quote.fareCents;
      setPaymentMethod(result.paymentMethod);
      setQuote(result.quote, result.driversNearby);
      setNow(Date.now());
      setStatus("ready");
    } catch (e) {
      if (id !== latest.current) return;
      setProblem(
        quoteProblem(
          e instanceof ApiRequestError ? e.code : null,
          e instanceof Error ? e.message : t("errors.generic"),
          language,
        ),
      );
      setStatus("error");
    }
  }, [
    request,
    setQuote,
    t,
    money,
    language,
    userAddress,
    userLatitude,
    userLongitude,
    destinationAddress,
    destinationLatitude,
    destinationLongitude,
    stops,
    categoryId,
    passengerCount,
    scheduledRideId,
  ]);

  useEffect(() => {
    previousFare.current = null;
    loadQuote();
  }, [loadQuote]);

  useEffect(() => {
    if (status !== "ready") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);

  const secondsLeft = quote ? secondsUntil(quote.expiresAt, now) : 0;

  useEffect(() => {
    if (status === "ready" && quote && secondsLeft === 0) setStatus("expired");
  }, [status, quote, secondsLeft]);

  useEffect(
    () => () => {
      if (!useRideStore.getState().scheduledRideId) return;
      useRideStore.getState().reset();
      useLocationStore.getState().setStops([]);
      useLocationStore.getState().setLocationStatus("idle");
    },
    [],
  );

  const backToScheduled = () => {
    if (!scheduledRideId) return;
    const id = scheduledRideId;
    setScheduledRide(null);
    router.replace({ pathname: "/(root)/scheduled/[id]", params: { id } });
  };

  const onRequested = (rideId: string) => {
    clear();
    if (scheduledRideId) {
      setScheduledRide(null);
      useLocationStore.getState().setLocationStatus("idle");
    }
    router.replace({ pathname: "/(root)/ride/[id]", params: { id: rideId } });
  };

  const savedPlaceOutside =
    problem !== null &&
    coverageProblem(problem.code) &&
    matchingPlace(
      savedPlaces,
      problem.code === "PICKUP_OUTSIDE_SERVICE_AREA"
        ? { latitude: userLatitude, longitude: userLongitude }
        : { latitude: destinationLatitude, longitude: destinationLongitude },
    ) !== null;

  const minutesLeft = Math.floor(secondsLeft / 60);

  return (
    <RideLayout title={t("booking.confirm.title")} snapPoints={["60%", "85%"]}>
      {status === "loading" && (
        <ListState kind="loading" message={t("booking.confirm.loading")} />
      )}
      {status === "error" && problem && (
        <View className="bg-white rounded-2xl p-5" accessibilityRole="alert">
          <Text className="text-lg font-JakartaBold">{problem.title}</Text>
          <Text className="text-base text-general-200 mt-2">
            {problem.message}
          </Text>
          {savedPlaceOutside && (
            <Text className="text-sm text-general-200 mt-2">
              {t("places.outsideCoverage")}
            </Text>
          )}
          {problem.retry && (
            <CustomButton
              title={t("common.retry")}
              className="mt-4"
              onPress={loadQuote}
            />
          )}
          {scheduledRideId &&
            (problem.code === "SCHEDULE_CLOSED" ||
              problem.code === "SCHEDULE_NOT_OPEN") && (
              <CustomButton
                title={t("booking.confirm.backToScheduled")}
                bgVariant="outline"
                textVariant="primary"
                className="mt-3"
                onPress={backToScheduled}
              />
            )}
          {problem.changeLocations && (
            <CustomButton
              title={t("booking.confirm.changeLocations")}
              bgVariant={problem.retry ? "outline" : "primary"}
              textVariant={problem.retry ? "primary" : "default"}
              className="mt-3"
              onPress={() => router.back()}
            />
          )}
        </View>
      )}
      {status === "expired" && (
        <View className="bg-white rounded-2xl p-5" accessibilityRole="alert">
          <Text className="text-base">{t("booking.confirm.expired")}</Text>
          <CustomButton
            title={t("booking.confirm.getNewPrice")}
            className="mt-4"
            onPress={loadQuote}
          />
        </View>
      )}
      {status === "ready" && quote && (
        <View>
          {notice && (
            <View
              className="bg-orange-100 rounded-xl p-3 mb-3"
              accessibilityRole="alert"
            >
              <Text className="text-sm text-orange-800">{notice}</Text>
            </View>
          )}
          {scheduledRideId && (
            <View className="bg-blue-50 rounded-xl p-3 mb-3">
              <Text className="text-sm text-blue-800">
                {t("booking.confirm.scheduledIntro")}
              </Text>
            </View>
          )}
          <View className="bg-white rounded-2xl p-4 mb-3">
            <Text
              className="text-base font-JakartaBold mb-1"
              accessibilityRole="header"
            >
              {t("booking.confirm.itinerary")}
            </Text>
            <Text className="text-xs text-general-200 mt-1">
              {t("booking.confirm.pickup")}
            </Text>
            <Text className="text-sm font-JakartaMedium">{userAddress}</Text>
            {quote.stops.map((stop, index) => (
              <View key={index}>
                <Text className="text-xs text-general-200 mt-2">
                  {t("booking.stops.number", { number: index + 1 })}
                </Text>
                <Text className="text-sm font-JakartaMedium">
                  {stop.address}
                </Text>
              </View>
            ))}
            <Text className="text-xs text-general-200 mt-2">
              {t("booking.confirm.destination")}
            </Text>
            <Text className="text-sm font-JakartaMedium">
              {destinationAddress}
            </Text>
          </View>
          <View className="flex flex-col w-full py-3 px-5 rounded-3xl bg-general-600">
            <Line
              label={t("booking.confirm.price")}
              value={money(quote.fareCents, quote.currency)}
              strong
            />
            <Line
              label={t("booking.confirm.distance")}
              value={km(quote.distanceMeters)}
            />
            <Line
              label={t("booking.confirm.tripTime")}
              value={duration(quote.durationSeconds / 60)}
            />
            {quote.category && (
              <Line
                label={t("booking.confirm.category")}
                value={quote.category.name}
              />
            )}
            <Line
              label={t("booking.confirm.passengers")}
              value={String(quote.passengerCount)}
            />
            <Line
              label={t("booking.confirm.driversNearby")}
              value={String(driversNearby ?? 0)}
              last
            />
          </View>

          <Text className="text-sm text-general-200 mt-4">
            {driversNearby
              ? t("booking.confirm.willOffer")
              : paymentMethod === "in_vehicle"
                ? t("booking.confirm.noDriversVehicle")
                : t("booking.confirm.noDrivers")}
          </Text>
          {quote.stops.length > 0 && (
            <Text className="text-sm text-general-200 mt-2">
              {t("booking.confirm.oneFare")}
            </Text>
          )}
          <Text className="text-sm text-general-200 mt-2">
            {paymentMethod === "in_vehicle"
              ? t("booking.confirm.priceNoteVehicle")
              : t("booking.confirm.priceNote")}{" "}
            {minutesLeft >= 1
              ? tn("booking.confirm.heldFor", minutesLeft)
              : t("booking.confirm.heldSeconds")}
          </Text>

          {paymentMethod === "in_vehicle" ? (
            <RequestRide
              quoteId={quote.id}
              fareCents={quote.fareCents}
              currency={quote.currency}
              onRequested={onRequested}
              onExpired={() => setStatus("expired")}
            />
          ) : (
            <StripeCheckout
              quoteId={quote.id}
              fareCents={quote.fareCents}
              currency={quote.currency}
              onRequested={onRequested}
              onExpired={() => setStatus("expired")}
            />
          )}
          <CustomButton
            title={t("booking.confirm.refresh")}
            bgVariant="outline"
            textVariant="primary"
            className="mb-10"
            onPress={loadQuote}
          />
        </View>
      )}
    </RideLayout>
  );
};

export default ConfirmRide;
