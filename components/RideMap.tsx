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
import { useI18n } from "@/lib/i18n";
import { calculateRegion } from "@/lib/map";
import { decodePolyline } from "@/shared/polyline";

import type { I18n } from "@/lib/i18n";
import type { DriverLocationView, Leg, Place } from "@/shared/contracts";

const EDGE_PADDING = { top: 140, right: 60, bottom: 420, left: 60 };

const describeLocation = (
  location: DriverLocationView | null,
  shared: boolean,
  t: I18n["t"],
) => {
  if (!shared) return null;
  if (!location) return t("ride.map.driverUnavailable");
  if (location.freshness === "live") return t("ride.map.driverLive");
  const minutes = Math.floor(location.ageSeconds / 60);
  return minutes >= 1
    ? t("ride.map.driverMinutes", { minutes })
    : t("ride.map.driverSeconds", { seconds: location.ageSeconds });
};

const RideMap = ({
  pickup,
  destination,
  stops = [],
  stopsCompleted = 0,
  leg,
  driverLocation,
  polyline,
}: {
  pickup: Place;
  destination: Place;
  stops?: Place[];
  stopsCompleted?: number;
  leg: Leg | null;
  driverLocation: DriverLocationView | null;
  polyline: string | null;
}) => {
  const { t } = useI18n();
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

  const target =
    leg === "destination" ? (stops[stopsCompleted] ?? destination) : pickup;
  const origin = driverLocation ?? (leg === "destination" ? pickup : null);

  const fit = useCallback(() => {
    const points = [
      target,
      ...(origin ? [origin] : []),
      ...(route ?? []),
      ...(leg ? [] : [pickup, ...stops, destination]),
    ];
    mapRef.current?.fitToCoordinates(points, {
      edgePadding: EDGE_PADDING,
      animated: true,
    });
  }, [target, origin, route, leg, pickup, destination, stops]);

  useEffect(() => {
    const key = `${leg}:${stopsCompleted}:${hasDriver}:${Boolean(route)}`;
    if (!following || fittedFor.current === key) return;
    fittedFor.current = key;
    fit();
  }, [leg, stopsCompleted, hasDriver, route, following, fit]);

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
  const label = describeLocation(driverLocation, leg !== null, t);

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
        <Marker
          coordinate={pickup}
          title={t("ride.map.pickup")}
          image={icons.point}
        />
        {stops.map((stop, index) => (
          <Marker
            key={`stop-${index}`}
            coordinate={stop}
            title={t("ride.map.stop", { number: index + 1 })}
            description={stop.address}
            image={icons.marker}
            opacity={index < stopsCompleted ? 0.4 : 1}
          />
        ))}
        <Marker
          coordinate={destination}
          title={t("ride.map.destination")}
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
            title={t("ride.map.driver")}
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
          accessibilityLabel={t("ride.map.recenterLabel")}
          onPress={() => {
            setFollowing(true);
            fittedFor.current = null;
            fit();
          }}
          className="absolute top-36 right-3 bg-white rounded-full px-4 min-h-[44px] justify-center shadow-md shadow-neutral-400"
        >
          <Text className="text-xs font-JakartaSemiBold">
            {t("ride.map.recenter")}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

export default RideMap;
