import type { PaymentMethod } from "../shared/currency";

type Env = Record<string, string | undefined>;

export function paymentMode(env: Env = process.env): PaymentMethod {
  return env.PAYMENT_MODE?.trim() === "card_online"
    ? "card_online"
    : "in_vehicle";
}
