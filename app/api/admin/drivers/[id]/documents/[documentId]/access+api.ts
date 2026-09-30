import { route } from "@/server/http";
import { accessDriverDocument } from "@/server/routes/verification";

export const POST = route(accessDriverDocument);
