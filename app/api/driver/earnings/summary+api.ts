import { route } from "@/server/http";
import { earningsSummary } from "@/server/routes/earnings";

export const GET = route(earningsSummary);
