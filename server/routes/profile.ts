import { profileRequestSchema } from "../../shared/contracts";
import { type Deps, readJson } from "../http";
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
