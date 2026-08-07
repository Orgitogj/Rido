import { Show } from "@clerk/expo";

import type { PropsWithChildren } from "react";

export function SignedOut({ children }: PropsWithChildren) {
  return <Show when="signed-out">{children}</Show>;
}
