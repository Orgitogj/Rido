import { route } from "@/server/http";
import { syncRideFromStripe } from "@/server/routes/admin";

export const POST = route(syncRideFromStripe);
