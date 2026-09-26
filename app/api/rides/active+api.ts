import { route } from "@/server/http";
import { getActiveRide } from "@/server/routes/rides";

export const GET = route(getActiveRide);
