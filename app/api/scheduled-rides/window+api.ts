import { route } from "@/server/http";
import { getScheduleWindow } from "@/server/routes/scheduled";

export const GET = route(getScheduleWindow);
