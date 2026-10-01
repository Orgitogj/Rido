import { route } from "@/server/http";
import { readiness } from "@/server/routes/system";

export const GET = route(readiness);
