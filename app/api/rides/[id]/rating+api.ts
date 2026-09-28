import { route } from "@/server/http";
import { getRating, rateRide } from "@/server/routes/ratings";

export const GET = route(getRating);
export const POST = route(rateRide);
