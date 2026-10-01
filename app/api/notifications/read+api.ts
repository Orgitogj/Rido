import { route } from "@/server/http";
import { readInbox } from "@/server/routes/inbox";

export const POST = route(readInbox);
