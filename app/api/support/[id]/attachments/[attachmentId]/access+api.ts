import { route } from "@/server/http";
import { supportAttachmentAccess } from "@/server/routes/inbox";

export const POST = route(supportAttachmentAccess);
