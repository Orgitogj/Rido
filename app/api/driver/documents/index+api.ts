import { route } from "@/server/http";
import { requestDocumentUpload } from "@/server/routes/driver";

export const POST = route(requestDocumentUpload);
