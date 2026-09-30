import { route } from "@/server/http";
import { completeDocumentUpload } from "@/server/routes/driver";

export const POST = route(completeDocumentUpload);
