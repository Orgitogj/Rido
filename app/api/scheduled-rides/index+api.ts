import { route } from "@/server/http";
import { createSchedule, listSchedules } from "@/server/routes/scheduled";

export const GET = route(listSchedules);
export const POST = route(createSchedule);
