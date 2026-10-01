import { route } from "@/server/http";
import { getAccount, patchAccount } from "@/server/routes/profile";

export const GET = route(getAccount);
export const PATCH = route(patchAccount);
