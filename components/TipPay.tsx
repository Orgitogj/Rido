import {
  PaymentSheetError,
  StripeProvider,
  useStripe,
} from "@stripe/stripe-react-native";
import { useRef, useState } from "react";
import { Text } from "react-native";

import CustomButton from "@/components/CustomButton";
import { useApi } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";

import type { TipCheckout, TipState } from "@/shared/contracts";

export interface TipPayProps {
  rideId: string;
  amountCents: number;
  idempotencyKey: string;
  title?: string;
  onDone: (state: TipState) => void;
}

const stripePublishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;

const TipPayButton = ({
  rideId,
  amountCents,
  idempotencyKey,
  title,
  onDone,
}: TipPayProps) => {
  const { t, error: errorText, money } = useI18n();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const request = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const pay = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const checkout = await request<TipCheckout>(`/api/rides/${rideId}/tip`, {
        body: { amountCents, idempotencyKey, consent: true },
      });
      const init = await initPaymentSheet({
        merchantDisplayName: "Uber Clone (demo)",
        paymentIntentClientSecret: checkout.paymentIntentClientSecret,
        customerId: checkout.customerId,
        customerEphemeralKeySecret: checkout.customerEphemeralKeySecret,
        returnURL: `myapp://receipt/${rideId}`,
      });
      if (init.error) {
        setError(t("pay.startFailed"));
        return;
      }
      const sheet = await presentPaymentSheet();
      const state = await request<TipState>(
        `/api/rides/${rideId}/tip/refresh`,
        {
          method: "POST",
          body: {},
        },
      );
      onDone(state);
      if (sheet.error && sheet.error.code !== PaymentSheetError.Canceled) {
        setError(t("pay.declined"));
      }
    } catch (e) {
      setError(errorText(e));
      request<TipState>(`/api/rides/${rideId}/tip`)
        .then(onDone)
        .catch(() => undefined);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      {error && (
        <Text
          className="text-sm text-red-600 mt-2"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}
      <CustomButton
        title={
          busy
            ? t("pay.tip.opening")
            : (title ?? t("pay.tip.pay", { amount: money(amountCents) }))
        }
        disabled={busy}
        className="mt-3"
        onPress={pay}
      />
    </>
  );
};

const TipPay = (props: TipPayProps) => {
  const { t } = useI18n();
  if (!stripePublishableKey) {
    return (
      <Text className="text-sm text-red-600 mt-2">
        {t("pay.notConfigured")}
      </Text>
    );
  }
  return (
    <StripeProvider
      publishableKey={stripePublishableKey}
      merchantIdentifier="merchant.com.uber"
      urlScheme="myapp"
    >
      <TipPayButton {...props} />
    </StripeProvider>
  );
};

export default TipPay;
