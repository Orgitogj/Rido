import { route } from "@/server/http";
import { createShare } from "@/server/routes/safety";

export const POST = route(createShare);
