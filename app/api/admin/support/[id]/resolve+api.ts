import { route } from "@/server/http";
import { resolveSupport } from "@/server/routes/admin";

export const POST = route(resolveSupport);
