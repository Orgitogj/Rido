import { route } from "@/server/http";
import { moderateFeedback } from "@/server/routes/admin";

export const POST = route(moderateFeedback);
