import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
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
  } = useLocationStore();
  const { quote, driversNearby, setQuote, clear } = useRideStore();
  const savedPlaces = usePlacesStore((s) => s.places);
  const [status, setStatus] = useState<Status>("loading");
  const [problem, setProblem] = useState<QuoteProblem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
      const result = await request<QuoteResponse>("/api/quotes", {
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
        },
      });
      if (id !== latest.current) return;
      const before = previousFare.current;
      if (before !== null) {
        setNotice(
          before === result.quote.fareCents
            ? t("booking.confirm.priceSame")
            : t("booking.confirm.priceChanged", {
                previous: money(before),
                current: money(result.quote.fareCents),
              }),
        );
      }
      previousFare.current = result.quote.fareCents;
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

  const onRequested = (rideId: string) => {
    clear();
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
          <View className="flex flex-col w-full py-3 px-5 rounded-3xl bg-general-600">
            <Line
              label={t("booking.confirm.price")}
              value={money(quote.fareCents)}
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
            <Line
              label={t("booking.confirm.driversNearby")}
              value={String(driversNearby ?? 0)}
              last
            />
          </View>

          <Text className="text-sm text-general-200 mt-4">
            {driversNearby
              ? t("booking.confirm.willOffer")
              : t("booking.confirm.noDrivers")}
          </Text>
          <Text className="text-sm text-general-200 mt-2">
            {t("booking.confirm.priceNote")}{" "}
            {minutesLeft >= 1
              ? tn("booking.confirm.heldFor", minutesLeft)
              : t("booking.confirm.heldSeconds")}
          </Text>

          <StripeCheckout
            quoteId={quote.id}
            fareCents={quote.fareCents}
            onRequested={onRequested}
            onExpired={() => setStatus("expired")}
          />
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
