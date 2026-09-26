import { route } from "@/server/http";
import { applyToDrive, getDriverProfile } from "@/server/routes/driver";

export const GET = route(getDriverProfile);
export const POST = route(applyToDrive);
