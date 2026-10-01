import {
  accountDeletionSchema,
  type AccountProfile,
  type Language,
  profileUpdateSchema,
  savedPlaceCreateSchema,
  savedPlaceUpdateSchema,
} from "../../shared/account";
import { profileRequestSchema, rideIdSchema } from "../../shared/contracts";
import { deletionStatus, requestAccountDeletion } from "../account";
import { type Deps, parseInput, readJson } from "../http";
import { deletePlace, listPlaces, savePlace, updatePlace } from "../places";
import { enforceRateLimit } from "../rateLimit";
import { ensureUser } from "../users";

export async function updateProfile(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const identity = await deps.authenticate(request);
  const { name } = await readJson(request, profileRequestSchema);
  const user = await ensureUser(deps.db, identity);
  await deps.db.query(
    "UPDATE mobility.users SET name = $2, updated_at = now() WHERE id = $1",
    [user.id, name],
  );
  return Response.json({ data: { id: user.id, name } });
}

async function accountProfile(
  deps: Deps,
  userId: string,
): Promise<AccountProfile> {
  const { rows } = await deps.db.query<{
    name: string | null;
    language: Language | null;
    driver_status: string | null;
    driver_name: string | null;
    is_operator: boolean;
  }>(
    `SELECT u.name, u.language, dp.status AS driver_status, dp.display_name AS driver_name,
            EXISTS (SELECT 1 FROM mobility.operators o WHERE o.user_id = u.id AND o.active) AS is_operator
       FROM mobility.users u
       LEFT JOIN mobility.driver_profiles dp ON dp.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  );
  const r = rows[0];
  return {
    name: r.name,
    language: r.language,
    driver: r.driver_status
      ? { status: r.driver_status, displayName: r.driver_name ?? "" }
      : null,
    isOperator: r.is_operator,
  };
}

export async function getAccount(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await ensureUser(deps.db, await deps.authenticate(request));
  return Response.json({ data: await accountProfile(deps, user.id) });
}

export async function patchAccount(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await ensureUser(deps.db, await deps.authenticate(request));
  const patch = await readJson(request, profileUpdateSchema);
  await enforceRateLimit(deps.db, "profileWrites", user.id, deps.now());
  await deps.db.query(
    `UPDATE mobility.users
        SET name = COALESCE($2, name), language = COALESCE($3, language), updated_at = now()
      WHERE id = $1`,
    [user.id, patch.name ?? null, patch.language ?? null],
  );
  return Response.json({ data: await accountProfile(deps, user.id) });
}

export async function getPlaces(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await ensureUser(deps.db, await deps.authenticate(request));
  return Response.json({ data: await listPlaces(deps.db, user.id) });
}

export async function createPlace(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const user = await ensureUser(deps.db, await deps.authenticate(request));
  const input = await readJson(request, savedPlaceCreateSchema);
  await enforceRateLimit(deps.db, "placeWrites", user.id, deps.now());
  const { place, created } = await savePlace(deps, user.id, input);
  return Response.json({ data: place }, { status: created ? 201 : 200 });
}

export async function patchPlace(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await ensureUser(deps.db, await deps.authenticate(request));
  const id = parseInput(rideIdSchema, params.id);
  const patch = await readJson(request, savedPlaceUpdateSchema);
  await enforceRateLimit(deps.db, "placeWrites", user.id, deps.now());
  return Response.json({
    data: await updatePlace(deps, user.id, id, patch),
  });
}

export async function removePlace(
  request: Request,
  params: { id?: string },
  deps: Deps,
) {
  const user = await ensureUser(deps.db, await deps.authenticate(request));
  const id = parseInput(rideIdSchema, params.id);
  await deletePlace(deps.db, user.id, id);
  return Response.json({ data: { deleted: true } });
}

export async function getDeletionStatus(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const identity = await deps.authenticate(request);
  const user = await ensureUser(deps.db, identity);
  return Response.json({
    data: await deletionStatus(deps.db, user.id, identity.factorAgeMinutes),
  });
}

export async function deleteAccount(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const identity = await deps.authenticate(request);
  const user = await ensureUser(deps.db, identity);
  await readJson(request, accountDeletionSchema);
  await enforceRateLimit(deps.db, "accountDeletion", user.id, deps.now());
  return Response.json({
    data: await requestAccountDeletion(deps, user, identity.factorAgeMinutes),
  });
}
