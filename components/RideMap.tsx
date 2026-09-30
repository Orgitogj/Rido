import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Text, TouchableOpacity, View } from "react-native";
import MapView, {
  AnimatedRegion,
  Marker,
  MarkerAnimated,
  Polyline,
  PROVIDER_DEFAULT,
} from "react-native-maps";

import { icons } from "@/constants";
import { calculateRegion } from "@/lib/map";
import { decodePolyline } from "@/shared/polyline";

import type { DriverLocationView, Leg, Place } from "@/shared/contracts";

const EDGE_PADDING = { top: 140, right: 60, bottom: 420, left: 60 };

const describeLocation = (
  location: DriverLocationView | null,
  shared: boolean,
) => {
  if (!shared) return null;
  if (!location) return "Driver location unavailable";
  if (location.freshness === "live") return "Driver location · live";
  const minutes = Math.floor(location.ageSeconds / 60);
  return minutes >= 1
    ? `Driver location · updated ${minutes} min ago`
    : `Driver location · updated ${location.ageSeconds}s ago`;
};

const RideMap = ({
  pickup,
  destination,
  leg,
  driverLocation,
  polyline,
}: {
  pickup: Place;
  destination: Place;
  leg: Leg | null;
  driverLocation: DriverLocationView | null;
  polyline: string | null;
}) => {
  const mapRef = useRef<MapView>(null);
  const [following, setFollowing] = useState(true);
  const fittedFor = useRef<string | null>(null);
  const driverCoordinate = useRef(
    new AnimatedRegion({
      latitude: driverLocation?.latitude ?? pickup.latitude,
      longitude: driverLocation?.longitude ?? pickup.longitude,
      latitudeDelta: 0,
      longitudeDelta: 0,
    }),
  ).current;
  const hasDriver = Boolean(driverLocation);

  useEffect(() => {
    if (!driverLocation) return;
    driverCoordinate
      .timing({
        latitude: driverLocation.latitude,
        longitude: driverLocation.longitude,
        latitudeDelta: 0,
        longitudeDelta: 0,
        duration: 800,
        useNativeDriver: false,
        toValue: 0 as never,
      })
      .start();
  }, [
    driverLocation?.latitude,
    driverLocation?.longitude,
    driverCoordinate,
    driverLocation,
  ]);

  const route = useMemo(() => {
    if (!polyline) return null;
    try {
      return decodePolyline(polyline);
    } catch {
      return null;
    }
  }, [polyline]);

  const target = leg === "destination" ? destination : pickup;
  const origin = driverLocation ?? (leg === "destination" ? pickup : null);

  const fit = useCallback(() => {
    const points = [
      target,
      ...(origin ? [origin] : []),
      ...(route ?? []),
      ...(leg ? [] : [pickup, destination]),
    ];
    mapRef.current?.fitToCoordinates(points, {
      edgePadding: EDGE_PADDING,
      animated: true,
    });
  }, [target, origin, route, leg, pickup, destination]);

  useEffect(() => {
    const key = `${leg}:${hasDriver}:${Boolean(route)}`;
    if (!following || fittedFor.current === key) return;
    fittedFor.current = key;
    fit();
  }, [leg, hasDriver, route, following, fit]);

  const initialRegion = useMemo(
    () =>
      calculateRegion({
        userLatitude: pickup.latitude,
        userLongitude: pickup.longitude,
        destinationLatitude: destination.latitude,
        destinationLongitude: destination.longitude,
      }),
    [
      pickup.latitude,
      pickup.longitude,
      destination.latitude,
      destination.longitude,
    ],
  );
  const label = describeLocation(driverLocation, leg !== null);

  return (
    <View className="flex-1 w-full">
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={{ flex: 1 }}
        mapType="mutedStandard"
        showsPointsOfInterest={false}
        initialRegion={initialRegion}
        userInterfaceStyle="light"
        onMapReady={fit}
        onPanDrag={() => setFollowing(false)}
      >
        <Marker coordinate={pickup} title="Pickup" image={icons.point} />
        <Marker
          coordinate={destination}
          title="Destination"
          image={icons.pin}
        />
        {route && route.length > 1 && (
          <Polyline coordinates={route} strokeColor="#0286FF" strokeWidth={4} />
        )}
        {!route && leg && origin && (
          <Polyline
            coordinates={[origin, target]}
            strokeColor="#0286FF"
            strokeWidth={2}
            lineDashPattern={[8, 8]}
          />
        )}
        {hasDriver && (
          <MarkerAnimated
            coordinate={driverCoordinate as never}
            title="Your driver"
            image={icons.selectedMarker}
            opacity={driverLocation?.freshness === "live" ? 1 : 0.5}
          />
        )}
      </MapView>
      {label && (
        <View className="absolute top-28 right-3 bg-white/90 rounded-lg px-2 py-1">
          <Text className="text-xs text-general-200">{label}</Text>
        </View>
      )}
      {!following && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Recenter map"
          onPress={() => {
            setFollowing(true);
            fittedFor.current = null;
            fit();
          }}
          className="absolute top-36 right-3 bg-white rounded-full px-3 py-2 shadow-md shadow-neutral-400"
        >
          <Text className="text-xs font-JakartaSemiBold">Recenter</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

export default RideMap;
