import { create } from "zustand";

import { MAX_STOPS, moveItem } from "@/lib/itinerary";
import { LocationStore, RideStore } from "@/types/type";

export const useLocationStore = create<LocationStore>((set, get) => ({
  userLatitude: null,
  userLongitude: null,
  userAddress: null,
  destinationLatitude: null,
  destinationLongitude: null,
  destinationAddress: null,
  stops: [],
  locationStatus: "idle",
  setLocationStatus: (locationStatus) => set(() => ({ locationStatus })),
  setUserLocation: ({ latitude, longitude, address }) => {
    set(() => ({
      userLatitude: latitude,
      userLongitude: longitude,
      userAddress: address,
    }));
    useRideStore.getState().clear();
  },
  setDestinationLocation: ({ latitude, longitude, address }) => {
    set(() => ({
      destinationLatitude: latitude,
      destinationLongitude: longitude,
      destinationAddress: address,
    }));
    useRideStore.getState().clear();
  },
  setStops: (stops) => {
    set(() => ({ stops: stops.slice(0, MAX_STOPS) }));
    useRideStore.getState().clear();
  },
  addStop: ({ latitude, longitude, address }) => {
    if (get().stops.length >= MAX_STOPS) return;
    set((s) => ({ stops: [...s.stops, { latitude, longitude, address }] }));
    useRideStore.getState().clear();
  },
  removeStop: (index) => {
    set((s) => ({ stops: s.stops.filter((_, i) => i !== index) }));
    useRideStore.getState().clear();
  },
  moveStop: (index, delta) => {
    set((s) => ({ stops: moveItem(s.stops, index, delta) }));
    useRideStore.getState().clear();
  },
  reset: () =>
    set(() => ({
      userLatitude: null,
      userLongitude: null,
      userAddress: null,
      destinationLatitude: null,
      destinationLongitude: null,
      destinationAddress: null,
      stops: [],
      locationStatus: "idle",
    })),
}));

export const useRideStore = create<RideStore>((set) => ({
  quote: null,
  driversNearby: null,
  categoryId: null,
  passengerCount: 1,
  scheduledRideId: null,
  setQuote: (quote, driversNearby) => set(() => ({ quote, driversNearby })),
  setCategory: (categoryId) =>
    set(() => ({ categoryId, quote: null, driversNearby: null })),
  setPassengerCount: (passengerCount) =>
    set(() => ({
      passengerCount: Math.min(8, Math.max(1, Math.round(passengerCount))),
      quote: null,
      driversNearby: null,
    })),
  setScheduledRide: (scheduledRideId) =>
    set(() => ({ scheduledRideId, quote: null, driversNearby: null })),
  clear: () => set(() => ({ quote: null, driversNearby: null })),
  reset: () =>
    set(() => ({
      quote: null,
      driversNearby: null,
      categoryId: null,
      passengerCount: 1,
      scheduledRideId: null,
    })),
}));
