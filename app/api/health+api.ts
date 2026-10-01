import { route } from "@/server/http";
import { health } from "@/server/routes/system";

export const GET = route(health);
