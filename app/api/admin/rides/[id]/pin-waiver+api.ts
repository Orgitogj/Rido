import { route } from "@/server/http";
import { waiveRidePin } from "@/server/routes/admin";

export const POST = route(waiveRidePin);
