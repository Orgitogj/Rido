import type { SqlClient } from "./db";

export type ReviewReason =
  "payment_dispute" | "refund_reversed" | "refund_mismatch";

export async function flagRideReview(
  tx: SqlClient,
  rideId: string,
  reason: ReviewReason,
) {
  await tx.query(
    `UPDATE mobility.rides
        SET needs_review = true, review_reason = $2,
            review_resolved_at = NULL, review_resolved_by = NULL, review_note = NULL,
            updated_at = now()
      WHERE id = $1`,
    [rideId, reason],
  );
}
