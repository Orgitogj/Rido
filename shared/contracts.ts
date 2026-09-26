import { z } from "zod";

export const placeSchema = z.strictObject({
  address: z.string().trim().min(1).max(300),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

export const coordinatesSchema = z.strictObject({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

export const quoteRequestSchema = z.strictObject({
  pickup: placeSchema,
  destination: placeSchema,
});

export const bookingRequestSchema = z.strictObject({
  quoteId: z.uuid(),
});

export const profileRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
});

export const rideIdSchema = z.uuid();
export const offerIdSchema = z.uuid();

export const driverApplicationSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(100),
  vehicleMake: z.string().trim().min(1).max(60),
  vehicleModel: z.string().trim().min(1).max(60),
  vehiclePlate: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[A-Za-z0-9 -]+$/),
  vehicleSeats: z.number().int().min(1).max(8),
});

export const deviceFixSchema = z.strictObject({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0).max(100_000).nullable().optional(),
  recordedAt: z.iso.datetime({ offset: true }).optional(),
});

export const availabilityRequestSchema = z.strictObject({
  online: z.boolean(),
  location: deviceFixSchema.optional(),
});

export const heartbeatRequestSchema = z.strictObject({
  location: deviceFixSchema.optional(),
});

export const locationUpdateSchema = z.strictObject({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0).max(100_000).nullable(),
  heading: z.number().finite().min(-1).max(360).nullable().optional(),
  speed: z.number().finite().min(-1).max(200).nullable().optional(),
  recordedAt: z.iso.datetime({ offset: true }),
});

export const pushTokenSchema = z
  .string()
  .max(200)
  .regex(/^(ExponentPushToken|ExpoPushToken)[[A-Za-z0-9_-]+]$/);

export const deviceRegistrationSchema = z.strictObject({
  token: pushTokenSchema,
  platform: z.enum(["ios", "android"]),
});

export const deviceRemovalSchema = z.strictObject({
  token: pushTokenSchema,
});

export const watchQuerySchema = z.strictObject({
  version: z.coerce.number().int().min(0).default(0),
  locationSeq: z.coerce.number().int().min(0).default(0),
  routeVersion: z.coerce.number().int().min(0).default(0),
  wait: z.coerce.number().int().min(0).max(25).default(20),
});

export const cancelRequestSchema = z.strictObject({
  reason: z.string().trim().min(1).max(40).optional(),
});

export const interruptRequestSchema = z.strictObject({
  reason: z.enum([
    "passenger_unsafe",
    "vehicle_problem",
    "driver_emergency",
    "passenger_request",
    "other",
  ]),
});

export const receiptIdSchema = z.uuid();

export const supportRequestSchema = z.strictObject({
  category: z.enum([
    "charge_question",
    "trip_problem",
    "driver_issue",
    "other",
  ]),
  message: z.string().trim().min(5).max(1000),
});

export const driverStatusRequestSchema = z.strictObject({
  status: z.enum(["arriving", "arrived", "in_progress", "completed"]),
});

export const rideStatuses = [
  "awaiting_payment",
  "requested",
  "offered",
  "accepted",
  "arriving",
  "arrived",
  "in_progress",
  "completed",
  "cancelled",
  "no_driver",
  "interrupted",
  "legacy",
] as const;
export type RideStatus = (typeof rideStatuses)[number];

export const paymentStatuses = [
  "pending",
  "requires_action",
  "processing",
  "authorized",
  "paid",
  "failed",
  "cancelled",
  "expired",
] as const;
export type PaymentStatus = (typeof paymentStatuses)[number];

export type DriverAction = "arriving" | "arrived" | "in_progress" | "completed";
export type RideAction = DriverAction | "cancel" | "interrupt";

export type Place = z.infer<typeof placeSchema>;
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type DriverApplication = z.infer<typeof driverApplicationSchema>;

export interface RideQuote {
  id: string;
  fareCents: number;
  currency: "usd";
  distanceMeters: number;
  durationSeconds: number;
  expiresAt: string;
}

export interface QuoteResponse {
  quote: RideQuote;
  driversNearby: number;
}

export interface BookingResponse {
  rideId: string;
  fareCents: number;
  currency: "usd";
  paymentStatus: PaymentStatus;
  paymentIntentClientSecret: string;
  customerId: string;
  customerEphemeralKeySecret: string;
}

export interface AssignedDriver {
  name: string;
  vehicle: string;
  plate: string;
  seats: number;
}

export interface RideView {
  id: string;
  viewer: "passenger" | "driver";
  status: RideStatus;
  paymentStatus: PaymentStatus;
  version: number;
  fareCents: number;
  currency: "usd";
  pickup: Place;
  destination: Place;
  distanceMeters: number | null;
  durationSeconds: number;
  createdAt: string;
  requestedAt: string | null;
  searchDeadline: string | null;
  acceptedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: "passenger" | "driver" | "system" | null;
  cancelReason: string | null;
  driver: AssignedDriver | null;
  passengerName: string | null;
  legacyDemoDriver: string | null;
  allowedActions: RideAction[];
  cancellation: CancellationPreview | null;
  rematchCount: number;
  settlement: SettlementState;
  serverTime: string;
}

export interface CancellationPreview {
  action: "cancel" | "interrupt";
  title: string;
  consequence: string;
  feeCents: 0;
}

export type SettlementState =
  "none" | "pending" | "retrying" | "needs_review" | "settled";

export type ReceiptPaymentState =
  | "no_payment"
  | "hold_active"
  | "hold_releasing"
  | "hold_released"
  | "hold_expired"
  | "charge_pending"
  | "charged"
  | "partially_refunded"
  | "refunded"
  | "legacy_demo";

export interface Receipt {
  rideId: string;
  outcome: RideStatus;
  outcomeText: string;
  cancelledBy: "passenger" | "driver" | "system" | null;
  isLegacyDemo: boolean;
  pickup: Place;
  destination: Place;
  driver: { name: string; vehicle: string; plate: string } | null;
  legacyDemoDriver: string | null;
  requestedAt: string | null;
  acceptedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  endedAt: string | null;
  currency: "usd";
  quotedFareCents: number;
  chargedCents: number;
  refundedCents: number;
  refundPendingCents: number;
  netChargedCents: number;
  paymentState: ReceiptPaymentState;
  paymentText: string;
  settlement: SettlementState;
  rematchCount: number;
}

export interface DriverTrip {
  rideId: string;
  pickup: Place;
  destination: Place;
  acceptedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  fareCents: number;
  currency: "usd";
  distanceMeters: number | null;
}

export interface DriverProfileView {
  id: string;
  status: "pending" | "approved" | "suspended";
  displayName: string;
  vehicleMake: string;
  vehicleModel: string;
  vehiclePlate: string;
  vehicleSeats: number;
  online: boolean;
}

export interface RideOfferView {
  id: string;
  rideId: string;
  pickup: Place;
  destination: Place;
  fareCents: number;
  distanceToPickupMeters: number;
  tripDistanceMeters: number | null;
  expiresAt: string;
  expiresInSeconds: number;
}

export interface DriverDashboard {
  profile: DriverProfileView | null;
  offer: RideOfferView | null;
  activeRide: RideView | null;
  serverTime: string;
}

export type Leg = "pickup" | "destination";

export interface DriverLocationView {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  heading: number | null;
  recordedAt: string;
  ageSeconds: number;
  freshness: "live" | "recent";
}

export interface EtaView {
  leg: Leg;
  durationSeconds: number;
  distanceMeters: number;
  arrivalAt: string;
  computedAt: string;
  source: "routed" | "estimate";
}

export interface LiveTripView {
  leg: Leg | null;
  locationSeq: number;
  locationStatus: "live" | "recent" | "unavailable" | "not_shared";
  driverLocation: DriverLocationView | null;
  eta: EtaView | null;
  routeVersion: number;
  route: { polyline: string | null } | null;
}

export interface WatchResponse {
  changed: boolean;
  ride: RideView | null;
  live: LiveTripView | null;
  serverTime: string;
}

export type LocationRejection =
  | "not_sharing"
  | "stale"
  | "future"
  | "low_accuracy"
  | "jump"
  | "out_of_order"
  | "throttled";

export interface LocationUpdateResult {
  accepted: boolean;
  reason: LocationRejection | null;
  sharing: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: { path: string; code: string }[];
  };
  requestId?: string;
}

export function formatCents(cents: number, currency = "usd"): string {
  if (!Number.isSafeInteger(cents)) return "--";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const fraction = String(abs % 100).padStart(2, "0");
  return `${sign}${currency === "usd" ? "$" : ""}${whole}.${fraction}`;
}

export type OperatorPermission = "view" | "support" | "refund";

const isoDate = z.iso.datetime({ offset: true });

export const adminListQuerySchema = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const adminRideQuerySchema = adminListQuerySchema.extend({
  rideId: z.uuid().optional(),
  status: z.enum(rideStatuses).optional(),
  paymentStatus: z.enum(paymentStatuses).optional(),
});

export const reviewCategories = [
  "interrupted_trip",
  "settlement_failing",
  "settlement_retrying",
  "authorization_expired_before_capture",
  "authorization_expiring_during_trip",
] as const;
export type ReviewCategory = (typeof reviewCategories)[number];

export const adminReviewQuerySchema = adminListQuerySchema.extend({
  category: z.enum(reviewCategories).optional(),
});

export const supportStatuses = ["open", "in_progress", "resolved"] as const;
export type SupportStatus = (typeof supportStatuses)[number];

export const adminSupportQuerySchema = adminListQuerySchema.extend({
  status: z.enum(supportStatuses).optional(),
  assigned: z.enum(["me", "unassigned", "any"]).default("any"),
  rideId: z.uuid().optional(),
});

export const reviewResolveSchema = z.strictObject({
  note: z.string().trim().min(3).max(1000),
});

export const supportVersionSchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
});

export const supportNoteSchema = z.strictObject({
  note: z.string().trim().min(1).max(2000),
});

export const supportResolveSchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
  resolutionMessage: z.string().trim().min(3).max(1000),
});

export const supportReopenSchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().min(3).max(500),
});

export const adminRefundSchema = z.strictObject({
  amountCents: z.number().int().positive(),
  reason: z.string().trim().min(3).max(200),
  expectedMaxRefundableCents: z.number().int().min(0),
  idempotencyKey: z.uuid(),
  supportRequestId: z.uuid().optional(),
});

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface OperatorMe {
  id: string;
  displayName: string;
  permissions: OperatorPermission[];
  stripeMode: "test" | "live" | "unconfigured";
}

export interface ReviewItem {
  rideId: string;
  category: ReviewCategory;
  status: RideStatus;
  paymentStatus: PaymentStatus;
  fareCents: number;
  capturedCents: number | null;
  settlementAttempts: number;
  settlementError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminRideListItem {
  rideId: string;
  status: RideStatus;
  paymentStatus: PaymentStatus;
  fareCents: number;
  capturedCents: number | null;
  refundedCents: number;
  needsReview: boolean;
  createdAt: string;
  pickupAddress: string;
  destinationAddress: string;
}

export interface RefundableSummary {
  capturedCents: number;
  refundedCents: number;
  inFlightCents: number;
  maxRefundableCents: number;
  refundable: boolean;
  reasonNotRefundable: string | null;
}

export interface AdminRefund {
  id: string;
  amountCents: number;
  status: string;
  reason: string;
  operatorName: string;
  verifiedOperator: boolean;
  stripeRefundId: string | null;
  lastError: string | null;
  supportRequestId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminRideDetail {
  ride: {
    id: string;
    status: RideStatus;
    paymentStatus: PaymentStatus;
    fareCents: number;
    capturedCents: number | null;
    refundedCents: number;
    currency: "usd";
    pickupAddress: string;
    destinationAddress: string;
    createdAt: string;
    requestedAt: string | null;
    completedAt: string | null;
    endedAt: string | null;
    cancelledBy: string | null;
    cancelReason: string | null;
    rematchCount: number;
    stripePaymentIntentId: string | null;
    isLegacyDemo: boolean;
  };
  passenger: { name: string | null; account: string };
  driver: { name: string; vehicle: string; plate: string } | null;
  settlement: {
    state: SettlementState;
    attempts: number;
    lastError: string | null;
    nextAttemptAt: string | null;
    settledAt: string | null;
    authorizationExpiresAt: string | null;
  };
  review: {
    open: boolean;
    reason: string | null;
    resolvedAt: string | null;
    resolvedBy: string | null;
    note: string | null;
  };
  events: {
    fromStatus: string;
    toStatus: string;
    actor: string;
    reason: string | null;
    createdAt: string;
  }[];
  offers: {
    driverName: string;
    status: string;
    distanceMeters: number;
    createdAt: string;
    expiresAt: string;
    respondedAt: string | null;
  }[];
  ledger: {
    kind: string;
    amountCents: number | null;
    actor: string;
    detail: string | null;
    createdAt: string;
  }[];
  notifications: {
    kind: string;
    recipient: "passenger" | "driver";
    status: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
    sentAt: string | null;
  }[];
  refunds: AdminRefund[];
  refundable: RefundableSummary;
  support: {
    id: string;
    status: SupportStatus;
    category: string;
    createdAt: string;
  }[];
  audit: {
    action: string;
    actor: string;
    result: string;
    reason: string | null;
    createdAt: string;
  }[];
}

export interface AdminSupportItem {
  id: string;
  rideId: string;
  category: string;
  status: SupportStatus;
  version: number;
  assignedTo: string | null;
  assignedToMe: boolean;
  preview: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface AdminSupportDetail extends AdminSupportItem {
  message: string;
  passenger: { name: string | null; account: string };
  resolutionMessage: string | null;
  resolvedBy: string | null;
  notes: { author: string; note: string; createdAt: string }[];
  history: {
    action: string;
    operator: string | null;
    fromStatus: string | null;
    toStatus: string | null;
    createdAt: string;
  }[];
}

export interface PassengerSupportRequest {
  id: string;
  rideId: string;
  category: string;
  status: SupportStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolutionMessage: string | null;
}
