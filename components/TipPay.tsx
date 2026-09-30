import {
  PaymentSheetError,
  StripeProvider,
  useStripe,
} from "@stripe/stripe-react-native";
import { useRef, useState } from "react";
import { Text } from "react-native";

import CustomButton from "@/components/CustomButton";
import { ApiRequestError, useApi } from "@/lib/fetch";
import { formatCents } from "@/lib/utils";

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
        setError(init.error.message || "Couldn't start the payment.");
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
        setError(sheet.error.message || "The payment didn't go through.");
      }
    } catch (e) {
      setError(
        e instanceof ApiRequestError ? e.message : "Something went wrong.",
      );
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
          className="text-sm text-red-500 mt-2"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}
      <CustomButton
        title={
          busy
            ? "Opening payment…"
            : (title ?? `Pay ${formatCents(amountCents)} tip`)
        }
        disabled={busy}
        className="mt-3"
        onPress={pay}
      />
    </>
  );
};

const TipPay = (props: TipPayProps) => {
  if (!stripePublishableKey) {
    return (
      <Text className="text-sm text-red-500 mt-2">
        Payments aren&apos;t configured. Set EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY.
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
