import { route } from "@/server/http";
import { syncTipRefundAction } from "@/server/routes/admin";

export const POST = route(syncTipRefundAction);
