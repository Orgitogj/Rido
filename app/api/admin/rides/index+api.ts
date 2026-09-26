import { route } from "@/server/http";
import { searchRides } from "@/server/routes/admin";

export const GET = route(searchRides);
