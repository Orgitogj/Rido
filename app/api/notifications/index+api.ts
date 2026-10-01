import { route } from "@/server/http";
import { getInbox } from "@/server/routes/inbox";

export const GET = route(getInbox);
