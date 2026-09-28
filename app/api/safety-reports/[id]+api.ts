import { route } from "@/server/http";
import { getReport } from "@/server/routes/safety";

export const GET = route(getReport);
