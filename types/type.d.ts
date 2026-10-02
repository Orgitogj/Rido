import { TextInputProps, TouchableOpacityProps } from "react-native";

import type { RideQuote } from "@/shared/contracts";

declare interface SelectedPlace {
  latitude: number;
  longitude: number;
  address: string;
  providerPlaceId?: string | null;
}

declare interface ButtonProps extends TouchableOpacityProps {
  title: string;
  bgVariant?: "primary" | "secondary" | "danger" | "outline" | "success";
  textVariant?: "primary" | "default" | "secondary" | "danger" | "success";
  IconLeft?: React.ComponentType<any>;
  IconRight?: React.ComponentType<any>;
  className?: string;
}
declare interface InputFieldProps extends TextInputProps {
  label: string;
  icon?: any;
  secureTextEntry?: boolean;
  labelStyle?: string;
  containerStyle?: string;
  inputStyle?: string;
  iconStyle?: string;
  className?: string;
}

declare interface GoogleInputProps {
  icon?: string;
  initialLocation?: string | null;
  containerStyle?: string;
  textInputBackgroundColor?: string;
  handlePress: (place: SelectedPlace) => void;
}

declare interface PaymentProps {
  quoteId: string;
  fareCents: number;
  onRequested: (rideId: string) => void;
  onExpired?: () => void;
  disabled?: boolean;
}

declare type LocationStatus =
  "idle" | "locating" | "ready" | "denied" | "unavailable";

declare interface LocationStore {
  userLatitude: number | null;
  userLongitude: number | null;
  userAddress: string | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  destinationAddress: string | null;
  stops: ItineraryStop[];
  locationStatus: LocationStatus;
  setLocationStatus: (status: LocationStatus) => void;
  setUserLocation: (place: SelectedPlace) => void;
  setDestinationLocation: (place: SelectedPlace) => void;
  setStops: (stops: ItineraryStop[]) => void;
  addStop: (place: SelectedPlace) => void;
  removeStop: (index: number) => void;
  moveStop: (index: number, delta: number) => void;
  reset: () => void;
}

declare interface ItineraryStop {
  latitude: number;
  longitude: number;
  address: string;
}

declare interface RideStore {
  quote: RideQuote | null;
  driversNearby: number | null;
  categoryId: string | null;
  passengerCount: number;
  scheduledRideId: string | null;
  setQuote: (quote: RideQuote, driversNearby: number) => void;
  setCategory: (categoryId: string | null) => void;
  setPassengerCount: (passengerCount: number) => void;
  setScheduledRide: (scheduledRideId: string | null) => void;
  clear: () => void;
  reset: () => void;
}
