import { route } from "@/server/http";
import { stripeWebhook } from "@/server/routes/webhook";

export const POST = route(stripeWebhook);
