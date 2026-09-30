import { PaymentSheetError, useStripe } from "@stripe/stripe-react-native";
import React, { useRef, useState } from "react";
import { Text } from "react-native";

import CustomButton from "@/components/CustomButton";
import { ApiRequestError, useApi } from "@/lib/fetch";
import { formatCents } from "@/lib/utils";
import { PaymentProps } from "@/types/type";

import type {
  BookingResponse,
  PaymentStatus,
  RideView,
} from "@/shared/contracts";

const NOT_AUTHORIZED: Partial<Record<PaymentStatus, string>> = {
  requires_action:
    "Your bank needs extra verification that wasn't completed. Please try again.",
  failed: "Your card was declined. Please try another card.",
  pending: "The card wasn't authorized. You have not been charged.",
  cancelled: "This request was cancelled. Refresh the price to try again.",
};

const Payment = ({ quoteId, fareCents, onRequested }: PaymentProps) => {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const request = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const openActiveRide = async () => {
    const active = await request<RideView | null>("/api/rides/active");
    if (active) onRequested(active.id);
    else setError("You already have a ride in progress.");
  };

  const requestRide = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);

    try {
      const booking = await request<BookingResponse>("/api/rides", {
        body: { quoteId },
      });

      const init = await initPaymentSheet({
        merchantDisplayName: "Uber Clone (demo)",
        paymentIntentClientSecret: booking.paymentIntentClientSecret,
        customerId: booking.customerId,
        customerEphemeralKeySecret: booking.customerEphemeralKeySecret,
        returnURL: "myapp://confirm-ride",
      });
      if (init.error) {
        setError(
          init.error.message || "Couldn't start the payment. Please try again.",
        );
        return;
      }

      const sheet = await presentPaymentSheet();
      if (sheet.error?.code === PaymentSheetError.Canceled) return;

      let ride: RideView;
      try {
        ride = await request<RideView>(`/api/rides/${booking.rideId}/refresh`, {
          method: "POST",
        });
      } catch {
        setError(
          "We couldn't confirm your card yet. Check Home for your ride before trying again.",
        );
        return;
      }

      if (ride.paymentStatus === "authorized") {
        onRequested(ride.id);
      } else {
        setError(
          sheet.error?.message ||
            NOT_AUTHORIZED[ride.paymentStatus] ||
            "Your card wasn't authorized.",
        );
      }
    } catch (e) {
      if (
        e instanceof ApiRequestError &&
        (e.code === "ACTIVE_RIDE_EXISTS" || e.code === "ALREADY_REQUESTED")
      ) {
        await openActiveRide().catch(() =>
          setError("You already have a ride in progress."),
        );
      } else if (e instanceof ApiRequestError && e.code === "QUOTE_EXPIRED") {
        setError("This price has expired. Tap Refresh price.");
      } else {
        setError(
          e instanceof Error
            ? e.message
            : "Something went wrong. Please try again.",
        );
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      {error && (
        <Text
          className="text-sm text-red-500 text-center mt-5"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}

      <CustomButton
        title={
          busy ? "Requesting…" : `Request ride · ${formatCents(fareCents)}`
        }
        className="mt-6 mb-4"
        disabled={busy}
        onPress={requestRide}
      />
    </>
  );
};

export default Payment;
