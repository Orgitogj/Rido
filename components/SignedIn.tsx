import { Show } from "@clerk/expo";

import type { PropsWithChildren } from "react";

export function SignedIn({ children }: PropsWithChildren) {
  return <Show when="signed-in">{children}</Show>;
}
