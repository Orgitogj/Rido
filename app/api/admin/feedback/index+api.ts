import { route } from "@/server/http";
import { listFeedback } from "@/server/routes/admin";

export const GET = route(listFeedback);
