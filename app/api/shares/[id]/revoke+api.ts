import { route } from "@/server/http";
import { revokeShare } from "@/server/routes/safety";

export const POST = route(revokeShare);
