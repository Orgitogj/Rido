import { route } from "@/server/http";
import { unregisterDevice } from "@/server/routes/devices";

export const POST = route(unregisterDevice);
