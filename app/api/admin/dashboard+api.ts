import { route } from "@/server/http";
import { adminDashboard } from "@/server/routes/system";

export const GET = route(adminDashboard);
