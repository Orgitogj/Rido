import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { RIDE_PIN } from "../shared/contracts";

import { ApiError } from "./errors";

import type { SqlClient } from "./db";
import type { RideRow } from "./lifecycle";

export function pinSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const secret = env.RIDE_PIN_SECRET?.trim() ?? "";
  return secret.length >= RIDE_PIN.minSecretLength ? secret : null;
}

export const newPinNonce = () => randomBytes(16).toString("hex");

export function derivePin(secret: string, rideId: string, nonce: string) {
  const mac = createHmac("sha256", secret)
    .update(`ride-pin:v1:${rideId}:${nonce}`)
    .digest();
  return String(mac.readUIntBE(0, 6) % 10 ** RIDE_PIN.digits).padStart(
    RIDE_PIN.digits,
    "0",
  );
}

export function pinMatches(
  secret: string,
  rideId: string,
  nonce: string,
  input: string,
) {
  const tag = (value: string) =>
    createHmac("sha256", secret).update(`ride-pin-check:${value}`).digest();
  return timingSafeEqual(tag(derivePin(secret, rideId, nonce)), tag(input));
}

export const pinRotation = (nonce: string | null) => ({
  pin_nonce: nonce,
  pin_failed_attempts: 0,
  pin_lockouts: 0,
  pin_locked_until: null,
  pin_verified_at: null,
  pin_waived_at: null,
  pin_waived_by: null,
});

export const pinRequired = (
  ride: Pick<RideRow, "pin_nonce" | "pin_waived_at">,
) => ride.pin_nonce !== null && ride.pin_waived_at === null;

export const pinBlocked = (ride: Pick<RideRow, "pin_lockouts">) =>
  ride.pin_lockouts >= RIDE_PIN.maxLockouts;

const blocked = () =>
  new ApiError(
    409,
    "PIN_BLOCKED",
    "Too many incorrect PINs for this pickup. Contact support, or cancel the ride so the passenger can be matched again.",
  );

export async function checkTripPin(
  tx: SqlClient,
  ride: RideRow,
  input: string | undefined,
  now: Date,
): Promise<
  | { ok: true; verified: boolean }
  | { ok: false; ride: RideRow; error: ApiError }
> {
  if (!pinRequired(ride)) return { ok: true, verified: false };
  if (pinBlocked(ride)) return { ok: false, ride, error: blocked() };
  if (ride.pin_locked_until && new Date(ride.pin_locked_until) > now) {
    return {
      ok: false,
      ride,
      error: new ApiError(
        429,
        "PIN_LOCKED",
        "Too many incorrect PINs. Wait a moment before trying again.",
        undefined,
        Math.max(
          1,
          Math.ceil(
            (new Date(ride.pin_locked_until).getTime() - now.getTime()) / 1000,
          ),
        ),
      ),
    };
  }
  const secret = pinSecret();
  if (!secret) {
    return {
      ok: false,
      ride,
      error: new ApiError(
        503,
        "PIN_UNAVAILABLE",
        "The trip PIN can't be checked right now. Contact support.",
      ),
    };
  }
  if (!input) {
    return {
      ok: false,
      ride,
      error: new ApiError(
        409,
        "PIN_REQUIRED",
        "Ask the passenger for the trip PIN to start.",
      ),
    };
  }
  if (pinMatches(secret, ride.id, ride.pin_nonce!, input)) {
    return { ok: true, verified: true };
  }
  const attempts = ride.pin_failed_attempts + 1;
  const lockNow = attempts >= RIDE_PIN.maxAttempts;
  const lockouts = ride.pin_lockouts + (lockNow ? 1 : 0);
  const final = lockouts >= RIDE_PIN.maxLockouts;
  const lockedUntil =
    lockNow && !final
      ? new Date(now.getTime() + RIDE_PIN.lockoutSeconds * 1000)
      : null;
  const { rows } = await tx.query<RideRow>(
    `UPDATE mobility.rides
        SET pin_failed_attempts = $2, pin_lockouts = $3, pin_locked_until = $4,
            version = version + 1, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [ride.id, lockNow ? 0 : attempts, lockouts, lockedUntil],
  );
  return {
    ok: false,
    ride: rows[0],
    error: final
      ? blocked()
      : lockNow
        ? new ApiError(
            429,
            "PIN_LOCKED",
            "Too many incorrect PINs. Wait a moment before trying again.",
            undefined,
            RIDE_PIN.lockoutSeconds,
          )
        : new ApiError(
            422,
            "PIN_INCORRECT",
            "That PIN doesn't match. Ask the passenger to read it again.",
          ),
  };
}
