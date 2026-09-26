import { route } from "@/server/http";
import { registerDevice } from "@/server/routes/devices";

export const POST = route(registerDevice);
