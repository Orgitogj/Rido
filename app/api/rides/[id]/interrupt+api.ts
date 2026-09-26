import { route } from "@/server/http";
import { interruptRide } from "@/server/routes/rides";

export const POST = route(interruptRide);
