import { route } from "@/server/http";
import { getSchedule } from "@/server/routes/scheduled";

export const GET = route(getSchedule);
