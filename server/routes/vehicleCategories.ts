import { rideIdSchema } from "../../shared/contracts";
import {
  categoryCreateSchema,
  categoryUpdateSchema,
} from "../../shared/vehicleCategory";
import { type Deps, parseInput, readJson } from "../http";
import { permissionsOf, requireOperator } from "../operators";
import {
  createCategory,
  listCategoriesAdmin,
  updateCategory,
} from "../vehicleCategories";

export async function listVehicleCategories(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const operator = await requireOperator(request, deps, "view", {
    type: "vehicle_category",
    id: null,
    action: "vehicle_category_list",
  });
  const allowed = permissionsOf(operator);
  if (!allowed.includes("configure") && !allowed.includes("verify")) {
    await requireOperator(request, deps, "configure", {
      type: "vehicle_category",
      id: null,
      action: "vehicle_category_list",
    });
  }
  return Response.json({ data: await listCategoriesAdmin(deps.db) });
}

export async function createVehicleCategory(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const operator = await requireOperator(request, deps, "configure", {
    type: "vehicle_category",
    id: null,
    action: "vehicle_category_create",
  });
  const input = await readJson(request, categoryCreateSchema);
  await createCategory(deps, operator, input);
  return Response.json(
    { data: await listCategoriesAdmin(deps.db) },
    { status: 201 },
  );
}

export async function updateVehicleCategory(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const id = parseInput(rideIdSchema, params.id);
  const operator = await requireOperator(request, deps, "configure", {
    type: "vehicle_category",
    id,
    action: "vehicle_category_update",
  });
  const input = await readJson(request, categoryUpdateSchema);
  await updateCategory(deps, operator, id, input);
  return Response.json({ data: await listCategoriesAdmin(deps.db) });
}
