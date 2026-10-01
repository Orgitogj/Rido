import { route } from "@/server/http";
import { deleteAccount, getDeletionStatus } from "@/server/routes/profile";

export const GET = route(getDeletionStatus);
export const POST = route(deleteAccount);
