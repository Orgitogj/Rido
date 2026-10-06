import React, { useRef, useState } from "react";
import { Text } from "react-native";

import CustomButton from "@/components/CustomButton";
import { ApiRequestError, useApi } from "@/lib/fetch";
import { useI18n } from "@/lib/i18n";
import { PaymentProps } from "@/types/type";

import type { BookingResponse, RideView } from "@/shared/contracts";

const RequestRide = ({
  quoteId,
  fareCents,
  currency,
  onRequested,
  onExpired,
  disabled,
}: PaymentProps) => {
  const { t, error: errorText, money } = useI18n();
  const request = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const openActiveRide = async () => {
    const active = await request<RideView | null>("/api/rides/active");
    if (active) onRequested(active.id);
    else setError(t("pay.activeRide"));
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
      if (booking.paymentMethod === "in_vehicle") {
        onRequested(booking.rideId);
      } else {
        setError(t("pay.webOnly"));
      }
    } catch (e) {
      if (
        e instanceof ApiRequestError &&
        (e.code === "ACTIVE_RIDE_EXISTS" || e.code === "ALREADY_REQUESTED")
      ) {
        await openActiveRide().catch(() => setError(t("pay.activeRide")));
      } else if (e instanceof ApiRequestError && e.code === "QUOTE_EXPIRED") {
        if (onExpired) onExpired();
        else setError(t("pay.quoteExpired"));
      } else {
        setError(errorText(e));
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
          className="text-sm text-red-600 text-center mt-5"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      )}
      <CustomButton
        title={
          busy
            ? t("pay.requesting")
            : t("pay.requestRide", { price: money(fareCents, currency) })
        }
        className="mt-6 mb-4"
        disabled={busy || disabled}
        onPress={requestRide}
      />
    </>
  );
};

export default RequestRide;
