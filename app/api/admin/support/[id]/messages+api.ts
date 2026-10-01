import { route } from "@/server/http";
import { adminSupportMessages, adminSupportReply } from "@/server/routes/inbox";

export const GET = route(adminSupportMessages);
export const POST = route(adminSupportReply);
