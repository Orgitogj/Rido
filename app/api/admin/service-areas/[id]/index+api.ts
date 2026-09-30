import { route } from "@/server/http";
import { getArea, updateArea } from "@/server/routes/serviceAreas";

export const GET = route(getArea);
export const PATCH = route(updateArea);
