import { route } from "@/server/http";
import { getReceipt } from "@/server/routes/receipts";

export const GET = route(getReceipt);
