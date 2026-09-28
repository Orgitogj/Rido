import { route } from "@/server/http";
import { getSafety } from "@/server/routes/safety";

export const GET = route(getSafety);
