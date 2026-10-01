import { route } from "@/server/http";
import { postSupportMessage } from "@/server/routes/inbox";

export const POST = route(postSupportMessage);
