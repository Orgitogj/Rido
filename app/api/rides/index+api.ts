import { route } from "@/server/http";
import { createBooking, listRides } from "@/server/routes/rides";

export const GET = route(listRides);
export const POST = route(createBooking);
