import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import ListState from "@/components/ListState";
import RideLayout from "@/components/RideLayout";
import StripeCheckout from "@/components/StripeCheckout";
import { ApiRequestError, useApi } from "@/lib/fetch";
import {
  formatDistance,
  priceHeldUntil,
  type QuoteProblem,
  quoteProblem,
} from "@/lib/quoteErrors";
import { formatCents, formatTime } from "@/lib/utils";
import { useLocationStore, useRideStore } from "@/store";

import type { QuoteResponse } from "@/shared/contracts";

type Status = "loading" | "ready" | "error";

const ConfirmRide = () => {
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
  const [status, setStatus] = useState<Status>("loading");
  const [problem, setProblem] = useState<QuoteProblem | null>(null);
  const latest = useRef(0);

  const loadQuote = useCallback(async () => {
    if (
      userLatitude === null ||
      userLongitude === null ||
      destinationLatitude === null ||
      destinationLongitude === null ||
      !userAddress ||
      !destinationAddress
    ) {
      setProblem(
        quoteProblem(
          null,
          "Pickup or destination is missing. Go back and choose both.",
        ),
      );
      setStatus("error");
      return;
    }
    const id = ++latest.current;
    setStatus("loading");
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
      setQuote(result.quote, result.driversNearby);
      setStatus("ready");
    } catch (e) {
      if (id !== latest.current) return;
      setProblem(
        quoteProblem(
          e instanceof ApiRequestError ? e.code : null,
          e instanceof Error ? e.message : "Couldn't get a price.",
        ),
      );
      setStatus("error");
    }
  }, [
    request,
    setQuote,
    userAddress,
    userLatitude,
    userLongitude,
    destinationAddress,
    destinationLatitude,
    destinationLongitude,
  ]);

  useEffect(() => {
    loadQuote();
  }, [loadQuote]);

  const onRequested = (rideId: string) => {
    clear();
    router.replace({ pathname: "/(root)/ride/[id]", params: { id: rideId } });
  };

  return (
    <RideLayout title="Confirm your ride" snapPoints={["60%", "85%"]}>
      {status === "loading" && (
        <ListState kind="loading" message="Getting a price for your trip…" />
      )}
      {status === "error" && problem && (
        <View
          className="bg-white rounded-2xl p-5"
          accessibilityLiveRegion="polite"
        >
          <Text className="text-lg font-JakartaBold">{problem.title}</Text>
          <Text className="text-base text-general-200 mt-2">
            {problem.message}
          </Text>
          {problem.retry && (
            <CustomButton
              title="Try again"
              className="mt-4"
              onPress={loadQuote}
            />
          )}
          {problem.changeLocations && (
            <CustomButton
              title="Change pickup or destination"
              bgVariant={problem.retry ? "outline" : "primary"}
              textVariant={problem.retry ? "primary" : "default"}
              className="mt-3"
              onPress={() => router.back()}
            />
          )}
        </View>
      )}
      {status === "ready" && quote && (
        <View>
          <View className="flex flex-col w-full py-3 px-5 rounded-3xl bg-general-600">
            <View className="flex flex-row items-center justify-between w-full border-b border-white py-3">
              <Text className="text-lg font-Jakarta">Price</Text>
              <Text className="text-lg font-JakartaBold text-[#0CC25F]">
                {formatCents(quote.fareCents)}
              </Text>
            </View>
            <View className="flex flex-row items-center justify-between w-full border-b border-white py-3">
              <Text className="text-lg font-Jakarta">Route distance</Text>
              <Text className="text-lg font-Jakarta">
                {formatDistance(quote.distanceMeters)}
              </Text>
            </View>
            <View className="flex flex-row items-center justify-between w-full border-b border-white py-3">
              <Text className="text-lg font-Jakarta">Est. trip time</Text>
              <Text className="text-lg font-Jakarta">
                {formatTime(quote.durationSeconds / 60)}
              </Text>
            </View>
            <View className="flex flex-row items-center justify-between w-full py-3">
              <Text className="text-lg font-Jakarta">
                Drivers online nearby
              </Text>
              <Text className="text-lg font-Jakarta">{driversNearby ?? 0}</Text>
            </View>
          </View>

          <Text className="text-sm text-general-200 mt-4">
            {driversNearby
              ? "We'll offer your ride to the nearest available driver."
              : "No drivers are online near you right now. You can still request: we'll search for 2 minutes and release the hold if nobody accepts."}
          </Text>
          <Text className="text-sm text-general-200 mt-2">
            This is the price you'll pay. Your card is authorized for exactly
            this amount when you request and charged only when the trip is
            completed. The price is held for about{" "}
            {priceHeldUntil(quote.expiresAt)} more minutes.
          </Text>

          <StripeCheckout
            quoteId={quote.id}
            fareCents={quote.fareCents}
            onRequested={onRequested}
          />
          <CustomButton
            title="Refresh price"
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
