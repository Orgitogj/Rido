import { route } from "@/server/http";
import { createPolicy } from "@/server/routes/serviceAreas";

export const POST = route(createPolicy);
