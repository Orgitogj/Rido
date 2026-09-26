import { route } from "@/server/http";
import { addSupportNote } from "@/server/routes/admin";

export const POST = route(addSupportNote);
