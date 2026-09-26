import { route } from "@/server/http";
import { resolveReview } from "@/server/routes/admin";

export const POST = route(resolveReview);
