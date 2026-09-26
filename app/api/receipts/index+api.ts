import { route } from "@/server/http";
import { listReceipts } from "@/server/routes/receipts";

export const GET = route(listReceipts);
