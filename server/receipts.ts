import { formatCents } from "../shared/contracts";
import { asCurrency } from "../shared/currency";

import { ratingState } from "./ratings";
import { settlementState } from "./rides";

import type { RideRow } from "./lifecycle";
import type {
  Receipt,
  ReceiptPaymentState,
  RideStatus,
  TipStatus,
} from "../shared/contracts";

export interface ReceiptRow extends RideRow {
  driver_name: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_plate: string | null;
  demo_driver_name: string | null;
  refund_pending_cents: number | string | null;
  rating_stars: number | null;
  rating_comment: string | null;
  rating_at: Date | null;
  tip_amount: number | null;
  tip_status: TipStatus | null;
  tip_refunded: number | null;
  tip_paid_at: Date | null;
  tip_refund_pending: number | null;
  disputes: { subject: "fare" | "tip"; status: string; amount_cents: number }[];
}

export const RECEIPT_SQL = `
  SELECT r.*, dp.display_name AS driver_name, dp.vehicle_make, dp.vehicle_model,
         dp.vehicle_plate,
         CASE WHEN dd.id IS NULL THEN NULL
              ELSE dd.first_name || ' ' || dd.last_name END AS demo_driver_name,
         (SELECT COALESCE(sum(f.amount_cents), 0) FROM mobility.refunds f
           WHERE f.ride_id = r.id
             AND f.status IN ('creating', 'pending', 'requires_action')) AS refund_pending_cents,
         rp.stars AS rating_stars, rp.comment AS rating_comment, rp.created_at AS rating_at,
         tp.amount_cents AS tip_amount, tp.status AS tip_status,
         tp.refunded_cents AS tip_refunded, tp.paid_at AS tip_paid_at,
         (SELECT COALESCE(sum(tf.amount_cents), 0)::int FROM mobility.tip_refunds tf
           WHERE tf.tip_id = tp.id
             AND tf.status IN ('creating', 'pending', 'requires_action')) AS tip_refund_pending,
         COALESCE((SELECT json_agg(json_build_object(
                     'subject', d.subject, 'status', d.status,
                     'amount_cents', d.amount_cents) ORDER BY d.created_at)
                     FROM mobility.disputes d
                    WHERE d.ride_id = r.id AND d.subject IN ('fare', 'tip')), '[]'::json) AS disputes
    FROM mobility.rides r
    LEFT JOIN mobility.driver_profiles dp ON dp.id = r.driver_profile_id
    LEFT JOIN mobility.demo_drivers dd ON dd.id = r.demo_driver_id
    LEFT JOIN mobility.ratings rp ON rp.ride_id = r.id AND rp.rater_role = 'passenger'
    LEFT JOIN mobility.tips tp ON tp.ride_id = r.id AND tp.status <> 'canceled'`;

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

const OUTCOME_TEXT: Record<RideStatus, string> = {
  awaiting_payment: "Waiting for card authorization",
  requested: "Searching for a driver",
  offered: "Searching for a driver",
  accepted: "Driver on the way",
  arriving: "Driver on the way",
  arrived: "Driver at pickup",
  in_progress: "Trip in progress",
  completed: "Trip completed",
  cancelled: "Cancelled",
  no_driver: "No driver found",
  interrupted: "Trip ended early by the driver",
  legacy: "Demo booking (simulated driver)",
};

export function paymentState(row: RideRow): {
  state: ReceiptPaymentState;
  text: string;
} {
  const fare = formatCents(row.fare_cents);
  const captured = row.captured_cents ?? 0;
  if (row.status === "legacy") {
    return {
      state: "legacy_demo",
      text: `Booked with the earlier demo flow and a simulated driver. Recorded payment: ${row.payment_status === "paid" ? formatCents(captured || row.fare_cents) : "none"}.`,
    };
  }
  if (row.payment_method === "in_vehicle") {
    if (row.collection_status === "collected") {
      return row.collection_method === "cash"
        ? { state: "paid_cash", text: `Paid ${fare} in cash to the driver.` }
        : {
            state: "paid_pos",
            text: `Paid ${fare} by card on the driver's terminal.`,
          };
    }
    if (row.collection_status === "unpaid") {
      return {
        state: "unpaid",
        text: `The driver reported that ${fare} was not paid. Contact support to settle it.`,
      };
    }
    if (row.collection_status === "waived") {
      return {
        state: "waived",
        text: "Support closed this trip without a payment.",
      };
    }
    if (row.collection_status === "pending") {
      return {
        state: "collection_pending",
        text: `Pay the driver ${fare} by card or cash. The receipt updates when the driver records it.`,
      };
    }
    if (
      row.status === "cancelled" ||
      row.status === "no_driver" ||
      row.status === "interrupted"
    ) {
      return { state: "nothing_due", text: "There is nothing to pay." };
    }
    return {
      state: "pay_in_vehicle",
      text: `You pay the driver ${fare} by card or cash at the end of the trip.`,
    };
  }
  if (row.payment_status === "paid") {
    if (row.refunded_cents >= captured && captured > 0) {
      return {
        state: "refunded",
        text: `Charged ${formatCents(captured)}, fully refunded.`,
      };
    }
    if (row.refunded_cents > 0) {
      return {
        state: "partially_refunded",
        text: `Charged ${formatCents(captured)}; ${formatCents(row.refunded_cents)} refunded.`,
      };
    }
    return {
      state: "charged",
      text: `Charged ${formatCents(captured)} to your card.`,
    };
  }
  if (row.payment_status === "processing") {
    return {
      state: "charge_pending",
      text: "Your bank is processing the payment.",
    };
  }
  if (row.payment_status === "authorized") {
    if (row.status === "completed") {
      return {
        state: "charge_pending",
        text: `Finalizing the ${fare} charge.`,
      };
    }
    if (
      row.status === "cancelled" ||
      row.status === "no_driver" ||
      row.status === "interrupted"
    ) {
      return {
        state: "hold_releasing",
        text: `The ${fare} hold on your card is being released. It is not a charge.`,
      };
    }
    return {
      state: "hold_active",
      text: `A ${fare} hold is on your card. You are charged only when the trip is completed.`,
    };
  }
  if (row.payment_status === "cancelled" && row.authorized_at) {
    return {
      state: "hold_released",
      text: `The ${fare} hold on your card was released. You were not charged.`,
    };
  }
  if (row.payment_status === "expired") {
    return {
      state: "hold_expired",
      text:
        row.status === "completed"
          ? "The card authorization expired before the charge could be taken. You were not charged; the trip is under review."
          : "The card authorization expired. You were not charged.",
    };
  }
  return { state: "no_payment", text: "No payment was taken." };
}

export function receiptFrom(row: ReceiptRow, now: Date): Receipt {
  const legacy = row.status === "legacy";
  const { state, text } = paymentState(row);
  const charged =
    row.payment_status === "paid"
      ? (row.captured_cents ?? (legacy ? row.fare_cents : 0))
      : 0;
  return {
    rideId: row.id,
    outcome: row.status,
    outcomeText: OUTCOME_TEXT[row.status],
    cancelledBy: row.cancelled_by,
    isLegacyDemo: legacy,
    pickup: {
      address: row.origin_address,
      latitude: row.origin_latitude,
      longitude: row.origin_longitude,
    },
    destination: {
      address: row.destination_address,
      latitude: row.destination_latitude,
      longitude: row.destination_longitude,
    },
    stops: row.stops,
    stopsCompleted: row.stops_completed,
    category: row.vehicle_category_id
      ? { id: row.vehicle_category_id, name: row.vehicle_category_name ?? "" }
      : null,
    passengerCount: row.passenger_count,
    paymentMethod: row.payment_method,
    collection:
      row.payment_method === "in_vehicle" && row.collection_status
        ? { status: row.collection_status, method: row.collection_method }
        : null,
    driver:
      row.driver_profile_id && row.driver_name
        ? {
            name: row.driver_name,
            vehicle: `${row.vehicle_make} ${row.vehicle_model}`,
            plate: row.vehicle_plate ?? "",
          }
        : null,
    legacyDemoDriver: legacy ? row.demo_driver_name : null,
    requestedAt: iso(row.requested_at ?? (legacy ? row.created_at : null)),
    acceptedAt: iso(row.accepted_at),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    endedAt: iso(row.completed_at ?? row.interrupted_at ?? row.cancelled_at),
    currency: asCurrency(row.currency),
    quotedFareCents: row.fare_cents,
    chargedCents: charged,
    refundedCents: row.refunded_cents,
    refundPendingCents: Number(row.refund_pending_cents ?? 0),
    netChargedCents: Math.max(0, charged - row.refunded_cents),
    paymentState: state,
    paymentText: text,
    settlement: settlementState(row),
    rematchCount: row.rematch_count,
    tip:
      row.tip_amount !== null && row.tip_status
        ? {
            amountCents: row.tip_amount,
            status: row.tip_status,
            refundedCents: row.tip_refunded ?? 0,
            refundPendingCents: Number(row.tip_refund_pending ?? 0),
            paidAt: iso(row.tip_paid_at),
          }
        : null,
    disputes: (row.disputes ?? []).map((d) => ({
      subject: d.subject,
      status: d.status,
      amountCents: d.amount_cents,
    })),
    rating: ratingState(
      row,
      row.rating_at
        ? {
            stars: row.rating_stars!,
            comment: row.rating_comment,
            created_at: row.rating_at,
          }
        : null,
      now,
    ),
  };
}
