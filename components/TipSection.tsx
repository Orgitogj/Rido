import * as Crypto from "expo-crypto";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import TipPay from "@/components/TipPay";
import { dollarsToCents } from "@/lib/adminFormat";
import { tipReasonText } from "@/lib/earningsText";
import { useApi, useApiQuery } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";

import type { TipState } from "@/shared/contracts";

const TipSection = ({ rideId }: { rideId: string }) => {
  const { t, language, error: errorText, money } = useI18n();
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
  const reasonText = tipReasonText(s.reason, language);
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
      setError(errorText(e, t("pay.tip.cancelFailed")));
      query.refetch();
    } finally {
      setCancelling(false);
    }
  };

  const typed = custom.trim().replace(",", ".");
  const customCents = typed ? dollarsToCents(typed) : null;
  const amount = typed ? customCents : choice;
  const amountError =
    typed &&
    (customCents === null ||
      customCents < s.minCents ||
      customCents > s.maxCents)
      ? t("pay.tip.range", {
          min: money(s.minCents),
          max: money(s.maxCents),
        })
      : null;
  const driver = s.driverName ?? t("pay.tip.yourDriver");

  return (
    <View className="bg-white rounded-2xl p-5 mt-4">
      <Text className="text-base font-JakartaBold" accessibilityRole="header">
        {t("pay.tip.title", { driver })}
      </Text>

      {tip && (tip.status === "succeeded" || tip.status === "processing") && (
        <Text className="text-sm mt-2">
          {t("pay.tip.line", {
            amount: money(tip.amountCents),
            status: t(`pay.tip.status.${tip.status}`),
          })}
          {tip.refundedCents > 0
            ? ` · ${t("pay.tip.refunded", { amount: money(tip.refundedCents) })}`
            : ""}
        </Text>
      )}

      {tip && tip.status !== "succeeded" && tip.status !== "processing" && (
        <>
          <Text className="text-sm mt-2">
            {t("pay.tip.unpaid", {
              amount: money(tip.amountCents),
              status: t(`pay.tip.status.${tip.status}`),
            })}
          </Text>
          {tip.lastError && language === "en" && (
            <Text className="text-xs text-red-600 mt-1">{tip.lastError}</Text>
          )}
          {s.eligible && (
            <TipPay
              rideId={rideId}
              amountCents={tip.amountCents}
              idempotencyKey={resumeKey}
              title={t("pay.tip.pay", { amount: money(tip.amountCents) })}
              onDone={onDone}
            />
          )}
          <CustomButton
            title={cancelling ? t("pay.tip.cancelling") : t("pay.tip.cancel")}
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
            {t("pay.tip.intro")}
          </Text>
          <View
            className="flex flex-row flex-wrap mt-3"
            accessibilityRole="radiogroup"
          >
            {s.suggestionsCents.map((cents) => (
              <Pressable
                key={cents}
                onPress={() => {
                  setChoice(cents);
                  setCustom("");
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: choice === cents && !custom }}
                className={`px-4 min-h-[44px] justify-center rounded-full mr-2 mb-2 border ${choice === cents && !custom ? "bg-[#0286FF] border-[#0286FF]" : "border-neutral-400"}`}
              >
                <Text
                  className={
                    choice === cents && !custom ? "text-white" : "text-black"
                  }
                >
                  {money(cents)}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={custom}
            onChangeText={setCustom}
            placeholder={t("pay.tip.other")}
            keyboardType="decimal-pad"
            accessibilityLabel={t("pay.tip.otherLabel")}
            className="border border-neutral-300 rounded-xl p-3 mt-1 min-h-[44px]"
          />
          {amountError && (
            <Text
              className="text-xs text-red-600 mt-1"
              accessibilityLiveRegion="polite"
            >
              {amountError}
            </Text>
          )}
          <CustomButton
            title={t("pay.tip.review")}
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
            {t("pay.tip.confirm", {
              amount: money(confirming.amountCents),
              driver,
            })}
          </Text>
          <Text className="text-xs text-general-200 mt-1">
            {t("pay.tip.confirmNote")}
          </Text>
          <TipPay
            rideId={rideId}
            amountCents={confirming.amountCents}
            idempotencyKey={confirming.key}
            onDone={onDone}
          />
          <CustomButton
            title={t("common.back")}
            bgVariant="outline"
            textVariant="primary"
            className="mt-3"
            onPress={() => setConfirming(null)}
          />
        </View>
      )}

      {error && (
        <Text
          className="text-sm text-red-600 mt-2"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}
    </View>
  );
};

export default TipSection;
