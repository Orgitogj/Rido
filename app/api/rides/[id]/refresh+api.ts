import { route } from "@/server/http";
import { refreshRidePayment } from "@/server/routes/rides";

export const POST = route(refreshRidePayment);
