import { useCallback, useEffect } from "react";
import { create } from "zustand";

import { useApi } from "@/lib/fetch";
import { registerUserReset } from "@/lib/session";

import type { PlacesView, SavedPlace, SavedPlaceKind } from "@/shared/account";

interface PlacesState {
  places: SavedPlace[];
  customRemaining: number;
  status: "idle" | "loading" | "ready" | "error";
  error: unknown;
  set: (view: PlacesView) => void;
  setStatus: (status: PlacesState["status"], error?: unknown) => void;
  clear: () => void;
}

export const usePlacesStore = create<PlacesState>((set) => ({
  places: [],
  customRemaining: 0,
  status: "idle",
  error: null,
  set: (view) =>
    set({
      places: view.places,
      customRemaining: view.customRemaining,
      status: "ready",
      error: null,
    }),
  setStatus: (status, error = null) => set({ status, error }),
  clear: () =>
    set({ places: [], customRemaining: 0, status: "idle", error: null }),
}));

registerUserReset(() => usePlacesStore.getState().clear());

export function newClientId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface PlaceInput {
  kind: SavedPlaceKind;
  label?: string | null;
  address: string;
  latitude: number;
  longitude: number;
  providerPlaceId?: string | null;
}

export function usePlaces() {
  const request = useApi();
  const state = usePlacesStore();

  const reload = useCallback(async () => {
    usePlacesStore.getState().setStatus("loading");
    try {
      usePlacesStore.getState().set(await request<PlacesView>("/api/places"));
    } catch (e) {
      usePlacesStore.getState().setStatus("error", e);
    }
  }, [request]);

  useEffect(() => {
    if (usePlacesStore.getState().status === "idle") reload();
  }, [reload]);

  const save = useCallback(
    async (input: PlaceInput, clientPlaceId = newClientId()) => {
      const place = await request<SavedPlace>("/api/places", {
        body: {
          ...input,
          ...(input.kind === "custom" ? { clientPlaceId } : {}),
        },
      });
      await reload();
      return place;
    },
    [request, reload],
  );

  const update = useCallback(
    async (id: string, patch: Partial<Omit<PlaceInput, "kind">>) => {
      const place = await request<SavedPlace>(`/api/places/${id}`, {
        method: "PATCH",
        body: patch,
      });
      await reload();
      return place;
    },
    [request, reload],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await request(`/api/places/${id}`, { method: "DELETE" });
      } finally {
        await reload();
      }
    },
    [request, reload],
  );

  return { ...state, reload, save, update, remove };
}

export function placeTitle(
  place: Pick<SavedPlace, "kind" | "label">,
  names: { home: string; work: string },
) {
  return place.kind === "home"
    ? names.home
    : place.kind === "work"
      ? names.work
      : (place.label ?? "");
}

export function matchingPlace(
  places: SavedPlace[],
  point: { latitude: number | null; longitude: number | null },
) {
  if (point.latitude === null || point.longitude === null) return null;
  return (
    places.find(
      (p) =>
        Math.abs(p.latitude - point.latitude!) < 0.00005 &&
        Math.abs(p.longitude - point.longitude!) < 0.00005,
    ) ?? null
  );
}
