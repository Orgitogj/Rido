import Stripe from "stripe";

import { requireEnv } from "./errors";

import type { PaymentStatus } from "../shared/contracts";

export const STRIPE_API_VERSION = "2024-06-20" as const;

export interface IntentSnapshot {
  id: string;
  status: Stripe.PaymentIntent.Status;
  amount: number;
  currency: string;
  client_secret: string | null;
  metadata: Record<string, string>;
  hasPaymentError: boolean;
  amountReceived: number;
  cancellationReason: string | null;
  captureBefore: number | null;
}

export interface RefundSnapshot {
  id: string;
  status: string;
  amount: number;
  paymentIntentId: string | null;
  failureReason: string | null;
}

export interface DisputeSnapshot {
  id: string;
  status: string;
  amount: number;
  currency: string;
  reason: string | null;
  paymentIntentId: string | null;
  balanceTransactions: { id: string; amount: number }[];
}

export interface WebhookEvent {
  id: string;
  type: string;
  paymentIntentId: string | null;
  refundId: string | null;
  disputeId: string | null;
}

export interface PaymentGateway {
  createCustomer(
    input: { userId: string; clerkId: string },
    idempotencyKey: string,
  ): Promise<{ id: string }>;
  createPaymentIntent(
    input: {
      amount: number;
      currency: string;
      customer: string;
      metadata: Record<string, string>;
      captureMethod?: "manual" | "automatic";
      description?: string;
    },
    idempotencyKey: string,
  ): Promise<IntentSnapshot>;
  retrievePaymentIntent(id: string): Promise<IntentSnapshot>;
  listRefunds(paymentIntentId: string): Promise<RefundSnapshot[]>;
  capturePaymentIntent(
    id: string,
    idempotencyKey: string,
  ): Promise<IntentSnapshot>;
  cancelPaymentIntent(
    id: string,
    idempotencyKey: string,
  ): Promise<IntentSnapshot>;
  createEphemeralKey(customerId: string): Promise<{ secret: string }>;
  parseWebhook(rawBody: string, signature: string): WebhookEvent;
  createRefund(
    input: {
      paymentIntentId: string;
      amount: number;
      metadata: Record<string, string>;
    },
    idempotencyKey: string,
  ): Promise<RefundSnapshot>;
  retrieveRefund(id: string): Promise<RefundSnapshot>;
  retrieveDispute(id: string): Promise<DisputeSnapshot>;
  listDisputes(paymentIntentId: string): Promise<DisputeSnapshot[]>;
}

function snapshot(intent: Stripe.PaymentIntent): IntentSnapshot {
  return {
    id: intent.id,
    status: intent.status,
    amount: intent.amount,
    currency: intent.currency,
    client_secret: intent.client_secret,
    metadata: intent.metadata ?? {},
    hasPaymentError: Boolean(intent.last_payment_error),
    amountReceived: intent.amount_received ?? 0,
    cancellationReason: intent.cancellation_reason ?? null,
    captureBefore:
      typeof intent.latest_charge === "object" && intent.latest_charge
        ? (intent.latest_charge.payment_method_details?.card?.capture_before ??
          null)
        : null,
  };
}

function refundSnapshot(refund: Stripe.Refund): RefundSnapshot {
  return {
    id: refund.id,
    status: refund.status ?? "pending",
    amount: refund.amount,
    paymentIntentId:
      typeof refund.payment_intent === "string"
        ? refund.payment_intent
        : (refund.payment_intent?.id ?? null),
    failureReason: refund.failure_reason ?? null,
  };
}

function disputeSnapshot(dispute: Stripe.Dispute): DisputeSnapshot {
  return {
    id: dispute.id,
    status: dispute.status,
    amount: dispute.amount,
    currency: dispute.currency,
    reason: dispute.reason ?? null,
    paymentIntentId:
      typeof dispute.payment_intent === "string"
        ? dispute.payment_intent
        : (dispute.payment_intent?.id ?? null),
    balanceTransactions: (dispute.balance_transactions ?? []).map((t) => ({
      id: t.id,
      amount: t.amount,
    })),
  };
}

export function stripeGateway(): PaymentGateway {
  let client: Stripe | undefined;
  const stripe = () =>
    (client ??= new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
      apiVersion: STRIPE_API_VERSION,
    }));

  return {
    async createCustomer({ userId, clerkId }, idempotencyKey) {
      const customer = await stripe().customers.create(
        { metadata: { app_user_id: userId, clerk_id: clerkId } },
        { idempotencyKey },
      );
      return { id: customer.id };
    },
    async createPaymentIntent(input, idempotencyKey) {
      const intent = await stripe().paymentIntents.create(
        {
          amount: input.amount,
          currency: input.currency,
          customer: input.customer,
          metadata: input.metadata,
          payment_method_types: ["card"],
          capture_method: input.captureMethod ?? "manual",
          description:
            input.description ??
            "Ride request (authorized now, charged on completion)",
        },
        { idempotencyKey },
      );
      return snapshot(intent);
    },
    async retrievePaymentIntent(id) {
      return snapshot(
        await stripe().paymentIntents.retrieve(id, {
          expand: ["latest_charge"],
        }),
      );
    },
    async capturePaymentIntent(id, idempotencyKey) {
      return snapshot(
        await stripe().paymentIntents.capture(id, {}, { idempotencyKey }),
      );
    },
    async cancelPaymentIntent(id, idempotencyKey) {
      return snapshot(
        await stripe().paymentIntents.cancel(id, {}, { idempotencyKey }),
      );
    },
    async createEphemeralKey(customerId) {
      const key = await stripe().ephemeralKeys.create(
        { customer: customerId },
        { apiVersion: STRIPE_API_VERSION },
      );
      if (!key.secret)
        throw new Error("Stripe returned no ephemeral key secret");
      return { secret: key.secret };
    },
    parseWebhook(rawBody, signature) {
      const event = stripe().webhooks.constructEvent(
        rawBody,
        signature,
        requireEnv("STRIPE_WEBHOOK_SECRET"),
      );
      const object = event.data.object as {
        object?: string;
        id?: string;
        payment_intent?: string | { id?: string } | null;
      };
      const linkedIntent =
        typeof object.payment_intent === "string"
          ? object.payment_intent
          : (object.payment_intent?.id ?? null);
      return {
        id: event.id,
        type: event.type,
        paymentIntentId:
          object.object === "payment_intent" && object.id
            ? object.id
            : linkedIntent,
        refundId: object.object === "refund" && object.id ? object.id : null,
        disputeId: object.object === "dispute" && object.id ? object.id : null,
      };
    },
    async createRefund(input, idempotencyKey) {
      return refundSnapshot(
        await stripe().refunds.create(
          {
            payment_intent: input.paymentIntentId,
            amount: input.amount,
            metadata: input.metadata,
          },
          { idempotencyKey },
        ),
      );
    },
    async retrieveRefund(id) {
      return refundSnapshot(await stripe().refunds.retrieve(id));
    },
    async retrieveDispute(id) {
      return disputeSnapshot(await stripe().disputes.retrieve(id));
    },
    async listDisputes(paymentIntentId) {
      const list = await stripe().disputes.list({
        payment_intent: paymentIntentId,
        limit: 100,
      });
      return list.data.map(disputeSnapshot);
    },
    async listRefunds(paymentIntentId) {
      const list = await stripe().refunds.list({
        payment_intent: paymentIntentId,
        limit: 100,
      });
      return list.data.map(refundSnapshot);
    },
  };
}

export function paymentStatusFor(intent: IntentSnapshot): PaymentStatus {
  switch (intent.status) {
    case "succeeded":
      return "paid";
    case "requires_capture":
      return "authorized";
    case "processing":
      return "processing";
    case "requires_action":
      return "requires_action";
    case "canceled":
      return intent.cancellationReason === "automatic"
        ? "expired"
        : "cancelled";
    case "requires_payment_method":
      return intent.hasPaymentError ? "failed" : "pending";
    default:
      return "pending";
  }
}

export function canChangePayment(
  current: PaymentStatus,
  next: PaymentStatus,
): boolean {
  if (current === next) return false;
  if (current === "paid" || current === "cancelled" || current === "expired") {
    return false;
  }
  if (current === "authorized") {
    return next === "paid" || next === "cancelled" || next === "expired";
  }
  return true;
}
