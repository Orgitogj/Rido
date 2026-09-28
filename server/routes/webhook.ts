import { syncDispute } from "../disputes";
import { ApiError } from "../errors";
import { type Deps, readRawBody } from "../http";
import { applyRefundSnapshot, syncRefundsForIntent } from "../refunds";
import { syncIntent } from "../rides";
import { applyTipRefundSnapshot, syncTipRefundsForIntent } from "../tipRefunds";
import { syncTip, tipForIntent } from "../tips";

export const HANDLED = new Set([
  "payment_intent.amount_capturable_updated",
  "payment_intent.succeeded",
  "payment_intent.processing",
  "payment_intent.payment_failed",
  "payment_intent.requires_action",
  "payment_intent.canceled",
]);

export const REFUND_EVENTS = new Set([
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.refunded",
  "charge.refund.updated",
]);

export const DISPUTE_EVENTS = new Set([
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
]);

export async function stripeWebhook(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const signature = request.headers.get("stripe-signature");
  if (!signature)
    throw new ApiError(400, "MISSING_SIGNATURE", "Missing Stripe signature.");
  const rawBody = await readRawBody(request, 512 * 1024);

  let event;
  try {
    event = deps.payments.parseWebhook(rawBody, signature);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "INVALID_SIGNATURE", "Invalid Stripe signature.");
  }

  const seen = await deps.db.query(
    "SELECT 1 FROM mobility.stripe_events WHERE event_id = $1",
    [event.id],
  );
  if (seen.rows.length)
    return Response.json({ received: true, duplicate: true });

  if (HANDLED.has(event.type) && event.paymentIntentId) {
    const { rows } = await deps.db.query<{ id: string }>(
      "SELECT id FROM mobility.rides WHERE stripe_payment_intent_id = $1",
      [event.paymentIntentId],
    );
    if (rows[0]) {
      const intent = await deps.payments.retrievePaymentIntent(
        event.paymentIntentId,
      );
      try {
        await syncIntent(deps, rows[0].id, intent);
      } catch (error) {
        if (!(error instanceof ApiError && error.code === "PAYMENT_MISMATCH"))
          throw error;
      }
    } else {
      const tipId = await tipForIntent(deps.db, event.paymentIntentId);
      if (tipId) {
        try {
          await syncTip(
            deps,
            tipId,
            await deps.payments.retrievePaymentIntent(event.paymentIntentId),
          );
        } catch (error) {
          if (!(error instanceof ApiError && error.code === "PAYMENT_MISMATCH"))
            throw error;
        }
      }
    }
  }

  if (REFUND_EVENTS.has(event.type)) {
    const refund = event.refundId
      ? await deps.payments.retrieveRefund(event.refundId)
      : null;
    const intentId = refund?.paymentIntentId ?? event.paymentIntentId;
    const tipId = intentId ? await tipForIntent(deps.db, intentId) : null;
    if (refund) {
      if (tipId) await applyTipRefundSnapshot(deps.db, refund, deps.now());
      else await applyRefundSnapshot(deps.db, refund, deps.now());
    } else if (intentId) {
      if (tipId) await syncTipRefundsForIntent(deps, intentId);
      else await syncRefundsForIntent(deps, intentId);
    }
  }

  if (DISPUTE_EVENTS.has(event.type) && event.disputeId) {
    await syncDispute(
      deps,
      await deps.payments.retrieveDispute(event.disputeId),
    );
  }

  await deps.db.query(
    "INSERT INTO mobility.stripe_events (event_id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [event.id, event.type],
  );
  return Response.json({ received: true });
}
