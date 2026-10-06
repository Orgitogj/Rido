import { route } from "@/server/http";
import { quoteSchedule } from "@/server/routes/scheduled";

export const POST = route(quoteSchedule);
