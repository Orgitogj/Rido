export interface QuoteProblem {
  title: string;
  message: string;
  retry: boolean;
  changeLocations: boolean;
}

const PROBLEMS: Record<string, Omit<QuoteProblem, "message">> = {
  PICKUP_OUTSIDE_SERVICE_AREA: {
    title: "Pickup is outside our service area",
    retry: false,
    changeLocations: true,
  },
  DESTINATION_OUTSIDE_SERVICE_AREA: {
    title: "Destination is outside our service area",
    retry: false,
    changeLocations: true,
  },
  NO_ROUTE: {
    title: "No drivable route",
    retry: false,
    changeLocations: true,
  },
  TRIP_TOO_SHORT: {
    title: "Trip is too short",
    retry: false,
    changeLocations: true,
  },
  TRIP_TOO_LONG: {
    title: "Trip is too long",
    retry: false,
    changeLocations: true,
  },
  ROUTING_UNAVAILABLE: {
    title: "Couldn't calculate your route",
    retry: true,
    changeLocations: false,
  },
  ROUTING_BUSY: {
    title: "Pricing is busy",
    retry: true,
    changeLocations: false,
  },
  RATE_LIMITED: {
    title: "Too many price requests",
    retry: true,
    changeLocations: false,
  },
  ROUTING_NOT_CONFIGURED: {
    title: "Pricing isn't available",
    retry: false,
    changeLocations: false,
  },
  PRICING_NOT_CONFIGURED: {
    title: "Pricing isn't available here yet",
    retry: false,
    changeLocations: false,
  },
  NETWORK: {
    title: "You're offline",
    retry: true,
    changeLocations: false,
  },
};

export function quoteProblem(
  code: string | null,
  message: string,
): QuoteProblem {
  const known = code ? PROBLEMS[code] : undefined;
  return {
    title: known?.title ?? "Couldn't get a price",
    message,
    retry: known?.retry ?? true,
    changeLocations: known?.changeLocations ?? false,
  };
}

export function formatDistance(meters: number) {
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

export function priceHeldUntil(expiresAt: string, now = new Date()) {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return Math.max(0, Math.floor(ms / 60_000));
}
