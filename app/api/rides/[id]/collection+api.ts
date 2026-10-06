import { route } from "@/server/http";
import { recordRideCollection } from "@/server/routes/collection";

export const POST = route(recordRideCollection);
