const DEFAULT_REGION = {
  latitude: 37.78825,
  longitude: -122.4324,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

const isCoord = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const calculateRegion = ({
  userLatitude,
  userLongitude,
  destinationLatitude,
  destinationLongitude,
}: {
  userLatitude: number | null;
  userLongitude: number | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
}) => {
  if (!isCoord(userLatitude) || !isCoord(userLongitude)) return DEFAULT_REGION;

  if (!isCoord(destinationLatitude) || !isCoord(destinationLongitude)) {
    return {
      latitude: userLatitude,
      longitude: userLongitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }

  const latitudeDelta = Math.max(
    0.01,
    Math.abs(userLatitude - destinationLatitude) * 1.3,
  );
  const longitudeDelta = Math.max(
    0.01,
    Math.abs(userLongitude - destinationLongitude) * 1.3,
  );

  return {
    latitude: (userLatitude + destinationLatitude) / 2,
    longitude: (userLongitude + destinationLongitude) / 2,
    latitudeDelta,
    longitudeDelta,
  };
};

export { isCoord };
