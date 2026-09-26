import { route } from "@/server/http";
import { updateRideStatus } from "@/server/routes/rides";

export const POST = route(updateRideStatus);
