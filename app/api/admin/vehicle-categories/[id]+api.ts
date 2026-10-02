import { route } from "@/server/http";
import { updateVehicleCategory } from "@/server/routes/vehicleCategories";

export const PATCH = route(updateVehicleCategory);
