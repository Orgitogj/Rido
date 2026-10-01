import { route } from "@/server/http";
import {
  getNotificationPreferences,
  putNotificationPreferences,
} from "@/server/routes/inbox";

export const GET = route(getNotificationPreferences);
export const PUT = route(putNotificationPreferences);
