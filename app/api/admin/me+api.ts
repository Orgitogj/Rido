import { route } from "@/server/http";
import { adminMe } from "@/server/routes/admin";

export const GET = route(adminMe);
