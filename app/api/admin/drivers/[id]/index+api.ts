import { route } from "@/server/http";
import { getDriverApplication } from "@/server/routes/verification";

export const GET = route(getDriverApplication);
