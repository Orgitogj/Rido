import * as Crypto from "expo-crypto";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import TipPay from "@/components/TipPay";
import { dollarsToCents } from "@/lib/adminFormat";
import { TIP_REASON_TEXT, TIP_STATUS_TEXT } from "@/lib/earningsText";
import { ApiRequestError, useApi, useApiQuery } from "@/lib/fetch";
import { formatCents } from "@/lib/utils";

import type { TipState } from "@/shared/contracts";

const TipSection = ({ rideId }: { rideId: string }) => {
  const request = useApi();
  const query = useApiQuery<TipState>(`/api/rides/${rideId}/tip`, {
    refetchOnFocus: true,
  });
  const [state, setState] = useState<TipState | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [confirming, setConfirming] = useState<{
    amountCents: number;
    key: string;
  } | null>(null);
  const [resumeKey] = useState(() => Crypto.randomUUID());
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) setState(query.data);
  }, [query.data]);

  const s = state;
  if (!s) return null;
  const tip = s.tip;
  const reasonText = s.reason ? TIP_REASON_TEXT[s.reason] : null;
  if (!tip && !s.eligible && !reasonText) return null;

  const onDone = (next: TipState) => {
    setState(next);
    if (next.tip?.status === "succeeded" || next.tip?.status === "processing") {
      setConfirming(null);
    }
  };

  const cancel = async () => {
    setCancelling(true);
    setError(null);
    try {
      setState(
        await request<TipState>(`/api/rides/${rideId}/tip/cancel`, {
          method: "POST",
          body: {},
        }),
      );
      setConfirming(null);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Couldn't cancel.");
      query.refetch();
    } finally {
      setCancelling(false);
    }
  };

  const customCents = custom.trim() ? dollarsToCents(custom) : null;
  const amount = custom.trim() ? customCents : choice;
  const amountError =
    custom.trim() &&
    (customCents === null ||
      customCents < s.minCents ||
      customCents > s.maxCents)
      ? `Enter an amount between ${formatCents(s.minCents)} and ${formatCents(s.maxCents)}.`
      : null;
  const driver = s.driverName ?? "your driver";

  return (
    <View className="bg-white rounded-2xl p-5 mt-4">
      <Text className="text-base font-JakartaBold">Tip {driver}</Text>

      {tip && (tip.status === "succeeded" || tip.status === "processing") && (
        <Text className="text-sm mt-2">
          {formatCents(tip.amountCents)} · {TIP_STATUS_TEXT[tip.status]}
          {tip.refundedCents > 0
            ? ` · ${formatCents(tip.refundedCents)} refunded`
            : ""}
        </Text>
      )}

      {tip && tip.status !== "succeeded" && tip.status !== "processing" && (
        <>
          <Text className="text-sm mt-2">
            {formatCents(tip.amountCents)} tip · {TIP_STATUS_TEXT[tip.status]}.
            You have not been charged.
          </Text>
          {tip.lastError && (
            <Text className="text-xs text-red-500 mt-1">{tip.lastError}</Text>
          )}
          {s.eligible && (
            <TipPay
              rideId={rideId}
              amountCents={tip.amountCents}
              idempotencyKey={resumeKey}
              title={`Pay ${formatCents(tip.amountCents)} tip`}
              onDone={onDone}
            />
          )}
          <CustomButton
            title={cancelling ? "Cancelling…" : "Cancel tip"}
            bgVariant="outline"
            textVariant="primary"
            disabled={cancelling}
            className="mt-3"
            onPress={cancel}
          />
        </>
      )}

      {!tip && !s.eligible && reasonText && (
        <Text className="text-sm text-general-200 mt-2">{reasonText}</Text>
      )}

      {!tip && s.eligible && !confirming && (
        <>
          <Text className="text-xs text-general-200 mt-1">
            Optional. Tips go to your driver in full and are charged separately
            from your fare.
          </Text>
          <View className="flex flex-row flex-wrap mt-3">
            {s.suggestionsCents.map((cents) => (
              <Pressable
                key={cents}
                onPress={() => {
                  setChoice(cents);
                  setCustom("");
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: choice === cents && !custom }}
                className={`px-4 py-2 rounded-full mr-2 mb-2 border ${choice === cents && !custom ? "bg-[#0286FF] border-[#0286FF]" : "border-neutral-300"}`}
              >
                <Text
                  className={
                    choice === cents && !custom ? "text-white" : "text-black"
                  }
                >
                  {formatCents(cents)}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={custom}
            onChangeText={setCustom}
            placeholder="Other amount"
            keyboardType="decimal-pad"
            accessibilityLabel="Other tip amount in dollars"
            className="border border-neutral-200 rounded-xl p-3 mt-1"
          />
          {amountError && (
            <Text className="text-xs text-red-500 mt-1">{amountError}</Text>
          )}
          <CustomButton
            title="Review tip"
            disabled={!amount || !!amountError}
            className="mt-3"
            onPress={() =>
              amount &&
              setConfirming({ amountCents: amount, key: Crypto.randomUUID() })
            }
          />
        </>
      )}

      {!tip && s.eligible && confirming && (
        <View className="mt-3">
          <Text className="text-base font-JakartaSemiBold">
            Tip {formatCents(confirming.amountCents)} to {driver}?
          </Text>
          <Text className="text-xs text-general-200 mt-1">
            Your card will only be charged after you confirm the payment on the
            next screen. This is a separate charge from your fare.
          </Text>
          <TipPay
            rideId={rideId}
            amountCents={confirming.amountCents}
            idempotencyKey={confirming.key}
            onDone={onDone}
          />
          <CustomButton
            title="Back"
            bgVariant="outline"
            textVariant="primary"
            className="mt-3"
            onPress={() => setConfirming(null)}
          />
        </View>
      )}

      {error && (
        <Text
          className="text-sm text-red-500 mt-2"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}
    </View>
  );
};

export default TipSection;
