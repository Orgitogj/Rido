import { route } from "@/server/http";
import { listEarnings } from "@/server/routes/earnings";

export const GET = route(listEarnings);
