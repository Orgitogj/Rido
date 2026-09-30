import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import MapViewDirections from "react-native-maps-directions";

import { icons } from "@/constants";
import { calculateRegion, isCoord } from "@/lib/map";
import { useLocationStore } from "@/store";

const directionsAPI = process.env.EXPO_PUBLIC_GOOGLE_API_KEY;

const Map = () => {
  const {
    userLongitude,
    userLatitude,
    destinationLatitude,
    destinationLongitude,
    locationStatus,
  } = useLocationStore();
  const mapRef = useRef<MapView>(null);
  const [routeFailed, setRouteFailed] = useState(false);

  const hasUser = isCoord(userLatitude) && isCoord(userLongitude);
  const hasDestination =
    isCoord(destinationLatitude) && isCoord(destinationLongitude);

  const region = useMemo(
    () =>
      calculateRegion({
        userLatitude,
        userLongitude,
        destinationLatitude,
        destinationLongitude,
      }),
    [userLatitude, userLongitude, destinationLatitude, destinationLongitude],
  );

  useEffect(() => {
    mapRef.current?.animateToRegion(region, 300);
  }, [region]);

  useEffect(() => {
    setRouteFailed(false);
  }, [userLatitude, userLongitude, destinationLatitude, destinationLongitude]);

  if (!hasUser) {
    const locating = locationStatus === "idle" || locationStatus === "locating";
    return (
      <View className="flex-1 w-full items-center justify-center rounded-2xl bg-general-500 p-5">
        {locating ? (
          <>
            <ActivityIndicator size="small" color="#000" />
            <Text className="text-sm text-general-200 mt-2">
              Finding your location…
            </Text>
          </>
        ) : (
          <Text className="text-sm text-general-200 text-center">
            Your location is unavailable. Choose a pickup address to see the
            map.
          </Text>
        )}
      </View>
    );
  }

  return (
    <View className="flex-1 w-full">
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        className="w-full h-full rounded-2xl"
        style={{ flex: 1 }}
        tintColor="black"
        mapType="mutedStandard"
        showsPointsOfInterest={false}
        initialRegion={region}
        showsUserLocation={true}
        userInterfaceStyle="light"
      >
        {hasDestination && (
          <Marker
            key="destination"
            coordinate={{
              latitude: destinationLatitude,
              longitude: destinationLongitude,
            }}
            title="Destination"
            image={icons.pin}
          />
        )}

        {hasDestination && directionsAPI && !routeFailed && (
          <MapViewDirections
            origin={{ latitude: userLatitude, longitude: userLongitude }}
            destination={{
              latitude: destinationLatitude,
              longitude: destinationLongitude,
            }}
            apikey={directionsAPI}
            strokeColor="#0286FF"
            strokeWidth={2}
            onError={() => setRouteFailed(true)}
          />
        )}
      </MapView>

      {hasDestination && (routeFailed || !directionsAPI) && (
        <View className="absolute bottom-2 left-2 right-2 bg-white/90 rounded-lg px-3 py-2">
          <Text className="text-xs text-general-200 text-center">
            Route preview unavailable. Prices are still calculated by the
            server.
          </Text>
        </View>
      )}
    </View>
  );
};

export default Map;
