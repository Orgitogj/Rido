import { route } from "@/server/http";
import { createTip, getTip } from "@/server/routes/tips";

export const GET = route(getTip);
export const POST = route(createTip);
