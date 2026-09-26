import { route } from "@/server/http";
import { heartbeat } from "@/server/routes/driver";

export const POST = route(heartbeat);
