import { route } from "@/server/http";
import { updateProfile } from "@/server/routes/profile";

export const POST = route(updateProfile);
