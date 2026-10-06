import { route } from "@/server/http";
import { cancelSchedule } from "@/server/routes/scheduled";

export const POST = route(cancelSchedule);
