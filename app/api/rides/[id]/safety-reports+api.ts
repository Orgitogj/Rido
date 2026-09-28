import { route } from "@/server/http";
import { createReport } from "@/server/routes/safety";

export const POST = route(createReport);
