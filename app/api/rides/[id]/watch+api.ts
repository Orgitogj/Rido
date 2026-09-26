import { route } from "@/server/http";
import { watchRide } from "@/server/routes/watch";

export const GET = route(watchRide);
