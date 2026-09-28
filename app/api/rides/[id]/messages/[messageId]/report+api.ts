import { route } from "@/server/http";
import { reportMessage } from "@/server/routes/safety";

export const POST = route(reportMessage);
