import { route } from "@/server/http";
import {
  createVehicleCategory,
  listVehicleCategories,
} from "@/server/routes/vehicleCategories";

export const GET = route(listVehicleCategories);
export const POST = route(createVehicleCategory);
