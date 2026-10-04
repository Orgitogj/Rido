import { route } from "@/server/http";
import { supportAttachmentAccess } from "@/server/routes/admin";

export const POST = route(supportAttachmentAccess);
