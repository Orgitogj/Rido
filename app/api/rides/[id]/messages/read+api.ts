import { route } from "@/server/http";
import { markChatRead } from "@/server/routes/chat";

export const POST = route(markChatRead);
