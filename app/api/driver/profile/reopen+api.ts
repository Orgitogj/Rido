import { route } from "@/server/http";
import { reopenDriverApplication } from "@/server/routes/driver";

export const POST = route(reopenDriverApplication);
