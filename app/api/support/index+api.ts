import { route } from "@/server/http";
import { listSupportRequests } from "@/server/routes/inbox";

export const GET = route(listSupportRequests);
