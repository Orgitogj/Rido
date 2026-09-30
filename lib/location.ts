import * as Location from "expo-location";
import { useCallback } from "react";

import { useLocationStore } from "@/store";

const LOCATION_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Location timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function useCurrentLocation() {
  const locationStatus = useLocationStore((s) => s.locationStatus);
  const setLocationStatus = useLocationStore((s) => s.setLocationStatus);
  const setUserLocation = useLocationStore((s) => s.setUserLocation);

  const locate = useCallback(async () => {
    setLocationStatus("locating");
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationStatus("denied");
        return;
      }

      const position = await withTimeout(
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        LOCATION_TIMEOUT_MS,
      );
      const { latitude, longitude } = position.coords;

      let address = `Current location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
      try {
        const [place] = await withTimeout(
          Location.reverseGeocodeAsync({ latitude, longitude }),
          LOCATION_TIMEOUT_MS,
        );
        const label = [place?.name, place?.city ?? place?.region]
          .filter(Boolean)
          .join(", ");
        if (label) address = label;
      } catch {}

      setUserLocation({ latitude, longitude, address });
      setLocationStatus("ready");
    } catch {
      setLocationStatus("unavailable");
    }
  }, [setLocationStatus, setUserLocation]);

  return { locationStatus, locate };
}
