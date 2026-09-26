import { route } from "@/server/http";
import { syncRefund } from "@/server/routes/admin";

export const POST = route(syncRefund);
