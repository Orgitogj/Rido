import { quoteRequestSchema } from "../../shared/contracts";
import { categoryAvailabilityQuerySchema } from "../../shared/vehicleCategory";
import { type Deps, parseInput, readJson } from "../http";
import { onlineDriversNear } from "../matching";
import { createQuoteFor } from "../quoting";
import { activeAreasContaining } from "../serviceAreas";
import { ensureUser } from "../users";
import { categoriesForArea } from "../vehicleCategories";

import type {
  CategoryAvailability,
  CategoryOption,
} from "../../shared/vehicleCategory";

export async function createQuote(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const identity = await deps.authenticate(request);
  const input = await readJson(request, quoteRequestSchema);
  const user = await ensureUser(deps.db, identity);
  const { body, created } = await createQuoteFor(deps, user.id, input);
  return Response.json({ data: body }, { status: created ? 201 : 200 });
}

export async function listCategoryAvailability(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await ensureUser(deps.db, await deps.authenticate(request));
  const q = parseInput(
    categoryAvailabilityQuerySchema,
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const now = deps.now();
  const pickup = { latitude: q.latitude, longitude: q.longitude };
  const areas = await activeAreasContaining(deps.db, pickup);
  const seen = new Set<string>();
  const categories: CategoryOption[] = [];
  for (const area of areas) {
    for (const c of await categoriesForArea(deps.db, area.id, now)) {
      if (seen.has(c.id) || c.capacity < q.passengers) continue;
      seen.add(c.id);
      categories.push({
        ...c,
        driversNearby: (
          await onlineDriversNear(deps.db, pickup, now, user.id, {
            categoryId: c.id,
            passengerCount: q.passengers,
          })
        ).length,
      });
    }
  }
  const body: CategoryAvailability = {
    categories,
    passengers: q.passengers,
    estimatedAt: now.toISOString(),
  };
  return Response.json({ data: body });
}
