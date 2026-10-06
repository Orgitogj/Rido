import { route } from "@/server/http";
import { listBalances } from "@/server/routes/collection";

export const GET = route(listBalances);
