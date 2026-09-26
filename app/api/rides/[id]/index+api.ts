import { route } from "@/server/http";
import { getRide } from "@/server/routes/rides";

export const GET = route(getRide);
