import { route } from "@/server/http";
import { runSweep } from "@/server/routes/internal";

export const POST = route(runSweep);
