import { route } from "@/server/http";
import { cancelRide } from "@/server/routes/rides";

export const POST = route(cancelRide);
