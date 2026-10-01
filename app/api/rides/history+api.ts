import { route } from "@/server/http";
import { listRideHistory } from "@/server/routes/rides";

export const GET = route(listRideHistory);
