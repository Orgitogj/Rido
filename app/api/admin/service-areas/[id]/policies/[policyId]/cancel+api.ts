import { route } from "@/server/http";
import { cancelPolicy } from "@/server/routes/serviceAreas";

export const POST = route(cancelPolicy);
