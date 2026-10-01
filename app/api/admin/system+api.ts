import { route } from "@/server/http";
import { systemStatus } from "@/server/routes/system";

export const GET = route(systemStatus);
