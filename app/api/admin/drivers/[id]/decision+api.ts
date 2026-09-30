import { route } from "@/server/http";
import { decideDriverApplication } from "@/server/routes/verification";

export const POST = route(decideDriverApplication);
