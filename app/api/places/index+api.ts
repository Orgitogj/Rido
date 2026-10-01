import { route } from "@/server/http";
import { createPlace, getPlaces } from "@/server/routes/profile";

export const GET = route(getPlaces);
export const POST = route(createPlace);
