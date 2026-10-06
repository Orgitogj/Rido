import { route } from "@/server/http";
import { getBalance, recordSettlement } from "@/server/routes/collection";

export const GET = route(getBalance);
export const POST = route(recordSettlement);
