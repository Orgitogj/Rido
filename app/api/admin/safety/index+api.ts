import { route } from "@/server/http";
import { listSafety } from "@/server/routes/safety";

export const GET = route(listSafety);
