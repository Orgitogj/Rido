import { create } from "zustand";

import { LocationStore, RideStore } from "@/types/type";

export const useLocationStore = create<LocationStore>((set) => ({
  userLatitude: null,
  userLongitude: null,
  userAddress: null,
  destinationLatitude: null,
  destinationLongitude: null,
  destinationAddress: null,
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
  reset: () =>
    set(() => ({
      userLatitude: null,
      userLongitude: null,
      userAddress: null,
      destinationLatitude: null,
      destinationLongitude: null,
      destinationAddress: null,
      locationStatus: "idle",
    })),
}));

export const useRideStore = create<RideStore>((set) => ({
  quote: null,
  driversNearby: null,
  setQuote: (quote, driversNearby) => set(() => ({ quote, driversNearby })),
  clear: () => set(() => ({ quote: null, driversNearby: null })),
}));
