import {
  deviceRegistrationSchema,
  deviceRemovalSchema,
} from "../../shared/contracts";
import { type Deps, readJson } from "../http";
import { ensureUser } from "../users";

export async function registerDevice(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const identity = await deps.authenticate(request);
  const { token, platform } = await readJson(request, deviceRegistrationSchema);
  const user = await ensureUser(deps.db, identity);
  await deps.db.query(
    `INSERT INTO mobility.push_tokens (token, user_id, platform)
     VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET
       user_id = EXCLUDED.user_id, platform = EXCLUDED.platform,
       disabled_at = NULL, disabled_reason = NULL, updated_at = now()`,
    [token, user.id, platform],
  );
  return Response.json({ data: { registered: true } });
}

export async function unregisterDevice(
  request: Request,
  _params: unknown,
  deps: Deps,
) {
  const identity = await deps.authenticate(request);
  const { token } = await readJson(request, deviceRemovalSchema);
  const user = await ensureUser(deps.db, identity);
  await deps.db.query(
    `UPDATE mobility.push_tokens
        SET disabled_at = now(), disabled_reason = 'signed_out', updated_at = now()
      WHERE token = $1 AND user_id = $2 AND disabled_at IS NULL`,
    [token, user.id],
  );
  return Response.json({ data: { registered: false } });
}
