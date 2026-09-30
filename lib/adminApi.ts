import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { buildQuery } from "@/lib/adminFormat";
import { useApi } from "@/lib/fetch";

import type { OperatorMe, Page } from "@/shared/contracts";

export const AdminContext = createContext<OperatorMe | null>(null);
export const useOperator = () => useContext(AdminContext);

export function usePaged<T>(
  path: string,
  filters: Record<string, string | undefined>,
) {
  const request = useApi();
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const key = JSON.stringify(filters);

  const load = useCallback(
    async (next: string | null) => {
      const mine = ++generation.current;
      setStatus("loading");
      try {
        const page = await request<Page<T>>(
          `${path}${buildQuery({ ...JSON.parse(key), limit: 20, cursor: next ?? undefined })}`,
        );
        if (mine !== generation.current) return;
        setItems((prev) => (next ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setStatus("ready");
        setError(null);
      } catch (e) {
        if (mine !== generation.current) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : "Couldn't load.");
      }
    },
    [path, key, request],
  );

  useEffect(() => {
    load(null);
  }, [load]);

  return {
    items,
    status,
    error,
    hasMore: cursor !== null,
    loadMore: () => cursor && load(cursor),
    reload: () => load(null),
  };
}
