import { route } from "@/server/http";
import { getChat } from "@/server/routes/chat";

export const GET = route(getChat);
