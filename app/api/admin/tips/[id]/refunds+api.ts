import { route } from "@/server/http";
import { createTipRefundAction } from "@/server/routes/admin";

export const POST = route(createTipRefundAction);
