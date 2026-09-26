import { route } from "@/server/http";
import { updateDriverLocation } from "@/server/routes/location";

export const POST = route(updateDriverLocation);
