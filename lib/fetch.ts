import { useAuth } from "@clerk/expo";
import Constants from "expo-constants";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { create } from "zustand";

import type { ApiErrorBody } from "@/shared/contracts";

export function apiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_SERVER_URL?.trim().replace(
    /\/$/,
    "",
  );
  if (configured) return configured;
  const hostUri = Constants.expoConfig?.hostUri;
  if (__DEV__ && hostUri) return `http://${hostUri}`;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin;
  }
  throw new ApiRequestError(
    0,
    "CONFIG",
    "EXPO_PUBLIC_SERVER_URL is not configured.",
  );
}

export const useSessionState = create<{
  expired: boolean;
  notice: boolean;
  markExpired: () => void;
  handled: () => void;
  clearNotice: () => void;
}>((set) => ({
  expired: false,
  notice: false,
  markExpired: () => set({ expired: true }),
  handled: () => set({ expired: false, notice: true }),
  clearNotice: () => set({ notice: false }),
}));

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

export async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string | null;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );
  options.signal?.addEventListener("abort", () => controller.abort());

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: {
        Accept: "application/json",
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    throw new ApiRequestError(
      0,
      "NETWORK",
      "Couldn't reach the server. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timeout);
  }

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {}
  if (!response.ok) {
    const body = json as Partial<ApiErrorBody> | null;
    throw new ApiRequestError(
      response.status,
      body?.error?.code ?? "HTTP_ERROR",
      body?.error?.message ?? `Request failed (${response.status}).`,
    );
  }
  return (json as { data: T }).data;
}

export function useApi() {
  const { getToken } = useAuth();
  return useCallback(
    async <T>(
      path: string,
      options: {
        method?: string;
        body?: unknown;
        signal?: AbortSignal;
        timeoutMs?: number;
      } = {},
    ) => {
      const token = await getToken();
      if (!token)
        throw new ApiRequestError(
          401,
          "UNAUTHENTICATED",
          "Please sign in again.",
        );
      try {
        return await apiRequest<T>(path, { ...options, token });
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) {
          useSessionState.getState().markExpired();
        }
        throw error;
      }
    },
    [getToken],
  );
}

export type QueryState<T> =
  | { status: "loading"; data: T | null; error: null; errorCode: null }
  | { status: "success"; data: T; error: null; errorCode: null }
  | {
      status: "error";
      data: T | null;
      error: string;
      errorCode: string | null;
    };

export function useApiQuery<T>(
  path: string | null,
  options: { refetchOnFocus?: boolean } = {},
) {
  const refetchOnFocus = options.refetchOnFocus ?? false;
  const request = useApi();
  const [state, setState] = useState<QueryState<T>>({
    status: "loading",
    data: null,
    error: null,
    errorCode: null,
  });
  const latest = useRef(0);

  const refetch = useCallback(async () => {
    if (!path) return;
    const id = ++latest.current;
    setState((prev) => ({
      status: "loading",
      data: prev.data,
      error: null,
      errorCode: null,
    }));
    try {
      const data = await request<T>(path);
      if (id === latest.current)
        setState({ status: "success", data, error: null, errorCode: null });
    } catch (error) {
      if (id === latest.current) {
        setState((prev) => ({
          status: "error",
          data: prev.data,
          error:
            error instanceof Error ? error.message : "Something went wrong.",
          errorCode: error instanceof ApiRequestError ? error.code : null,
        }));
      }
    }
  }, [path, request]);

  useEffect(() => {
    if (!refetchOnFocus) refetch();
  }, [refetch, refetchOnFocus]);

  useFocusEffect(
    useCallback(() => {
      if (refetchOnFocus) refetch();
    }, [refetch, refetchOnFocus]),
  );

  return { ...state, refetch };
}
