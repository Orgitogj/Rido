import { route } from "@/server/http";
import { rideEarnings } from "@/server/routes/earnings";

export const GET = route(rideEarnings);
