import { route } from "@/server/http";
import { listCategoryAvailability } from "@/server/routes/quotes";

export const GET = route(listCategoryAvailability);
