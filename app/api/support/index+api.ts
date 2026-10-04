import { route } from "@/server/http";
import { createSupport, listSupportRequests } from "@/server/routes/inbox";

export const GET = route(listSupportRequests);
export const POST = route(createSupport);
