import { route } from "@/server/http";
import { completeSupportAttachment } from "@/server/routes/inbox";

export const POST = route(completeSupportAttachment);
