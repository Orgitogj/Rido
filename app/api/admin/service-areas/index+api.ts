import { route } from "@/server/http";
import { createArea, listAreas } from "@/server/routes/serviceAreas";

export const GET = route(listAreas);
export const POST = route(createArea);
