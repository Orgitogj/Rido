import { route } from "@/server/http";
import { listReview } from "@/server/routes/admin";

export const GET = route(listReview);
