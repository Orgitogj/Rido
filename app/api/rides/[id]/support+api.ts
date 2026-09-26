import { route } from "@/server/http";
import {
  createSupportRequest,
  listRideSupport,
} from "@/server/routes/receipts";

export const GET = route(listRideSupport);
export const POST = route(createSupportRequest);
