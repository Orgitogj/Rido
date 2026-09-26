import { route } from "@/server/http";
import { createQuote } from "@/server/routes/quotes";

export const POST = route(createQuote);
