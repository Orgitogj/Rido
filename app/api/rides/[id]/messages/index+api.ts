import { route } from "@/server/http";
import { listChatMessages, sendChatMessage } from "@/server/routes/chat";

export const GET = route(listChatMessages);
export const POST = route(sendChatMessage);
