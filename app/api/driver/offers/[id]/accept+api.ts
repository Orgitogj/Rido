import { route } from "@/server/http";
import { acceptOffer } from "@/server/routes/driver";

export const POST = route(acceptOffer);
