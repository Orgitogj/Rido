import { route } from "@/server/http";
import { createSupportAttachment } from "@/server/routes/inbox";

export const POST = route(createSupportAttachment);
