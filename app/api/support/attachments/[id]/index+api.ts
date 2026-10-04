import { route } from "@/server/http";
import { deleteSupportAttachment } from "@/server/routes/inbox";

export const DELETE = route(deleteSupportAttachment);
