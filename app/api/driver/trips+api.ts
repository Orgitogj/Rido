import { route } from "@/server/http";
import { listDriverTrips } from "@/server/routes/receipts";

export const GET = route(listDriverTrips);
