import { route } from "@/server/http";
import { triageSafety } from "@/server/routes/safety";

export const POST = route(triageSafety);
