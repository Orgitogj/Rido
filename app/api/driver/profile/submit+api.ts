import { route } from "@/server/http";
import { submitDriverApplication } from "@/server/routes/driver";

export const POST = route(submitDriverApplication);
