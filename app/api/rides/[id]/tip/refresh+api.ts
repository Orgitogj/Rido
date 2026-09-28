import { route } from "@/server/http";
import { refreshTipPayment } from "@/server/routes/tips";

export const POST = route(refreshTipPayment);
