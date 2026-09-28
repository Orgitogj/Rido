import { route } from "@/server/http";
import { cancelTipPayment } from "@/server/routes/tips";

export const POST = route(cancelTipPayment);
