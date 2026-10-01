import { route } from "@/server/http";
import { getSupportRequest } from "@/server/routes/inbox";

export const GET = route(getSupportRequest);
