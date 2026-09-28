import { route } from "@/server/http";
import { getSafetyReport } from "@/server/routes/safety";

export const GET = route(getSafetyReport);
