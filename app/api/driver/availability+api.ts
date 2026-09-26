import { route } from "@/server/http";
import { setAvailability } from "@/server/routes/driver";

export const POST = route(setAvailability);
