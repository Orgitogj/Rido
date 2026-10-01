import { route } from "@/server/http";
import { patchPlace, removePlace } from "@/server/routes/profile";

export const PATCH = route(patchPlace);
export const DELETE = route(removePlace);
