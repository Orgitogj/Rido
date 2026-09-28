import {
  RATING_RULES,
  type RatingIneligibleReason,
  type RatingSummary,
  type RideRatingState,
  type RideStatus,
} from "../shared/contracts";

import { type Database, transaction } from "./db";
import { ApiError, notFound } from "./errors";

export type RaterRole = "passenger" | "driver";

export interface RatingRideFields {
  status: RideStatus;
  payment_status: string;
  demo_driver_id: number | null;
  driver_profile_id: string | null;
  completed_at: Date | null;
}

export interface RatingRecord {
  stars: number;
  comment: string | null;
  created_at: Date;
}

const DAY_MS = 24 * 3600 * 1000;
const EDIT_MS = RATING_RULES.editMinutes * 60 * 1000;

export function ratingEligibility(
  ride: RatingRideFields,
  now: Date,
): { reason: RatingIneligibleReason | null; rateBy: Date | null } {
  if (ride.status === "legacy" || ride.demo_driver_id !== null) {
    return { reason: "simulated", rateBy: null };
  }
  if (ride.status !== "completed" || !ride.completed_at) {
    return { reason: "not_completed", rateBy: null };
  }
  if (!ride.driver_profile_id)
    return { reason: "no_counterpart", rateBy: null };
  const rateBy = new Date(
    new Date(ride.completed_at).getTime() + RATING_RULES.windowDays * DAY_MS,
  );
  if (ride.payment_status !== "paid") {
    return { reason: "payment_pending", rateBy };
  }
  if (now.getTime() > rateBy.getTime()) {
    return { reason: "window_closed", rateBy };
  }
  return { reason: null, rateBy };
}

export function ratingState(
  ride: RatingRideFields,
  mine: RatingRecord | null,
  now: Date,
): RideRatingState {
  const { reason, rateBy } = ratingEligibility(ride, now);
  const editableUntil = mine
    ? new Date(new Date(mine.created_at).getTime() + EDIT_MS)
    : null;
  return {
    eligible: !mine && reason === null,
    reason,
    stars: mine?.stars ?? null,
    comment: mine?.comment ?? null,
    submittedAt: mine ? new Date(mine.created_at).toISOString() : null,
    editableUntil: editableUntil ? editableUntil.toISOString() : null,
    canEdit: !!editableUntil && now.getTime() <= editableUntil.getTime(),
    rateBy: rateBy ? rateBy.toISOString() : null,
  };
}

export function toSummary(
  value: { count: number | string; avg: number | string | null } | null,
): RatingSummary {
  const count = Number(value?.count ?? 0);
  const avg =
    value?.avg === null || value?.avg === undefined ? null : Number(value.avg);
  return {
    count,
    average:
      count >= RATING_RULES.summaryMinimum && avg !== null
        ? Math.round(avg * 10) / 10
        : null,
  };
}

export function summarySql(
  rateeUserExpr: string,
  raterRole: RaterRole,
  nowRef: string,
) {
  return `(SELECT json_build_object('count', count(*), 'avg', avg(g.stars)::float8)
             FROM mobility.ratings g
            WHERE g.ratee_user_id = ${rateeUserExpr}
              AND g.rater_role = '${raterRole}'
              AND g.moderation_status <> 'removed'
              AND g.created_at <= ${nowRef} - make_interval(mins => ${RATING_RULES.editMinutes}))`;
}

export const needsModeration = (stars: number, comment: string | null) =>
  stars <= 2 || !!comment;

const NOT_ALLOWED: Record<RatingIneligibleReason, string> = {
  simulated: "Simulated trips can't be rated.",
  not_completed: "Only completed trips can be rated.",
  no_counterpart: "There is no one to rate for this trip.",
  payment_pending: "You can rate this trip once its payment is confirmed.",
  window_closed: `Trips can only be rated within ${RATING_RULES.windowDays} days.`,
};

interface RatingRow extends RatingRecord {
  id: string;
  moderation_status: string;
}

export async function submitRating(
  deps: { db: Database; now: () => Date },
  userId: string,
  rideId: string,
  input: { stars: number; comment?: string | null },
): Promise<{ state: RideRatingState; created: boolean }> {
  const now = deps.now();
  const comment = input.comment ? input.comment : null;
  return transaction(deps.db, async (tx) => {
    const { rows } = await tx.query<
      RatingRideFields & { user_id: string; driver_user_id: string | null }
    >(
      `SELECT r.user_id, r.status, r.payment_status, r.demo_driver_id,
              r.driver_profile_id, r.completed_at, dp.user_id AS driver_user_id
         FROM mobility.rides r
         LEFT JOIN mobility.driver_profiles dp ON dp.id = r.driver_profile_id
        WHERE r.id = $1
        FOR SHARE OF r`,
      [rideId],
    );
    const ride = rows[0];
    const role: RaterRole | null =
      ride?.user_id === userId
        ? "passenger"
        : ride && ride.driver_user_id === userId
          ? "driver"
          : null;
    if (!ride || !role) throw notFound("Ride");
    const rateeId = role === "passenger" ? ride.driver_user_id : ride.user_id;
    if (rateeId === userId) {
      throw new ApiError(403, "CANNOT_RATE_SELF", "You can't rate yourself.");
    }

    const select = () =>
      tx.query<RatingRow>(
        `SELECT id, stars, comment, created_at, moderation_status
           FROM mobility.ratings WHERE ride_id = $1 AND rater_role = $2
           FOR UPDATE`,
        [rideId, role],
      );

    let existing = (await select()).rows[0] ?? null;
    if (!existing) {
      const { reason } = ratingEligibility(ride, now);
      if (reason || !rateeId || !ride.driver_profile_id) {
        const why = reason ?? "no_counterpart";
        throw new ApiError(409, "RATING_NOT_ALLOWED", NOT_ALLOWED[why]);
      }
      const { rows: inserted } = await tx.query<RatingRow>(
        `INSERT INTO mobility.ratings
           (ride_id, rater_role, rater_user_id, ratee_user_id, driver_profile_id,
            stars, comment, moderation_status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         ON CONFLICT (ride_id, rater_role) DO NOTHING
         RETURNING id, stars, comment, created_at, moderation_status`,
        [
          rideId,
          role,
          userId,
          rateeId,
          ride.driver_profile_id,
          input.stars,
          comment,
          needsModeration(input.stars, comment) ? "pending" : "none",
          now,
        ],
      );
      if (inserted[0]) {
        return { state: ratingState(ride, inserted[0], now), created: true };
      }
      existing = (await select()).rows[0];
    }

    if (existing.stars === input.stars && existing.comment === comment) {
      return { state: ratingState(ride, existing, now), created: false };
    }
    if (now.getTime() > new Date(existing.created_at).getTime() + EDIT_MS) {
      throw new ApiError(
        409,
        "RATING_LOCKED",
        `Ratings can only be changed within ${RATING_RULES.editMinutes} minutes of submitting.`,
      );
    }
    const { rows: updated } = await tx.query<RatingRow>(
      `UPDATE mobility.ratings
          SET stars = $2, comment = $3, edit_count = edit_count + 1,
              version = version + 1, updated_at = $4,
              moderation_status = CASE WHEN moderation_status = 'removed' THEN 'removed'
                                       WHEN $5::boolean THEN 'pending' ELSE 'none' END
        WHERE id = $1
        RETURNING id, stars, comment, created_at, moderation_status`,
      [
        existing.id,
        input.stars,
        comment,
        now,
        needsModeration(input.stars, comment),
      ],
    );
    return { state: ratingState(ride, updated[0], now), created: false };
  });
}
