import { route } from "@/server/http";
import { declineOffer } from "@/server/routes/driver";

export const POST = route(declineOffer);
