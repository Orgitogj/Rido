import { route } from "@/server/http";
import { changeDriverCategories } from "@/server/routes/verification";

export const POST = route(changeDriverCategories);
