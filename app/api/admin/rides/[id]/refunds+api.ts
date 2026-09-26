import { route } from "@/server/http";
import { createRefund } from "@/server/routes/admin";

export const POST = route(createRefund);
