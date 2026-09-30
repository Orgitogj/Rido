import { route } from "@/server/http";
import { listDriverApplications } from "@/server/routes/verification";

export const GET = route(listDriverApplications);
