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
  chatSeq: z.coerce.number().int().min(0).optional(),
  wait: z.coerce.number().int().min(0).max(25).default(20),
});

export const CHAT_RULES = {
  maxLength: 500,
  pageSize: 30,
  maxPageSize: 50,
} as const;

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F]/;

export const chatBodySchema = z
  .string()
  .max(CHAT_RULES.maxLength * 2)
  .transform((s) => s.replace(/\r\n?/g, "\n").trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(CHAT_RULES.maxLength)
      .refine((s) => !CONTROL_CHARACTERS.test(s), {
        message: "Messages can't contain control characters.",
      }),
  );

export const chatSendSchema = z.strictObject({
  clientMessageId: z.uuid(),
  body: chatBodySchema,
});

export const chatQuerySchema = z
  .strictObject({
    after: z.coerce.number().int().min(0).optional(),
    before: z.coerce.number().int().min(1).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CHAT_RULES.maxPageSize)
      .default(CHAT_RULES.pageSize),
  })
  .refine((q) => q.after === undefined || q.before === undefined, {
    message: "Use either after or before, not both.",
  });

export const chatReadSchema = z.strictObject({
  seq: z.number().int().min(0),
});

export const RATING_RULES = {
  minStars: 1,
  maxStars: 5,
  commentMaxLength: 300,
  windowDays: 7,
  editMinutes: 60,
  summaryMinimum: 3,
} as const;

export const ratingSubmitSchema = z.strictObject({
  stars: z.number().int().min(RATING_RULES.minStars).max(RATING_RULES.maxStars),
  comment: z
    .string()
    .trim()
    .max(RATING_RULES.commentMaxLength)
    .refine((s) => !CONTROL_CHARACTERS.test(s), {
      message: "Feedback can't contain control characters.",
    })
    .nullable()
    .optional(),
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
  chat: RideChatSummary;
  rating: RideRatingState;
  counterpartRating: RatingSummary | null;
  serverTime: string;
}

export type ChatState =
  "open" | "waiting" | "closed" | "expired" | "unavailable";

export interface RideChatSummary {
  state: ChatState;
  canSend: boolean;
  latestSeq: number;
  unread: number;
}

export interface ChatView extends RideChatSummary {
  rideId: string;
  role: "passenger" | "driver";
  counterpartName: string | null;
  readSeq: number;
  availableUntil: string | null;
  maxLength: number;
}

export interface ChatMessageView {
  id: string;
  seq: number;
  mine: boolean;
  clientMessageId: string | null;
  body: string;
  createdAt: string;
  earlierDriver: boolean;
}

export interface ChatPage {
  chat: ChatView;
  messages: ChatMessageView[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}

export interface ChatSendResult {
  chat: ChatView;
  message: ChatMessageView;
  duplicate: boolean;
}

export type RatingIneligibleReason =
  | "not_completed"
  | "payment_pending"
  | "simulated"
  | "no_counterpart"
  | "window_closed";

export interface RatingSummary {
  average: number | null;
  count: number;
}

export interface RideRatingState {
  eligible: boolean;
  reason: RatingIneligibleReason | null;
  stars: number | null;
  comment: string | null;
  submittedAt: string | null;
  editableUntil: string | null;
  canEdit: boolean;
  rateBy: string | null;
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
  rating: RideRatingState;
  tip: ReceiptTip | null;
  disputes: ReceiptDispute[];
}

export interface ReceiptTip {
  amountCents: number;
  status: TipStatus;
  refundedCents: number;
  refundPendingCents: number;
  paidAt: string | null;
}

export interface ReceiptDispute {
  subject: "fare" | "tip";
  status: string;
  amountCents: number;
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
  ratingPending: boolean;
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
  rating: RatingSummary;
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
  passengerRating: RatingSummary;
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
    retryAfterSeconds?: number;
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
  "payment_dispute",
  "refund_reversed",
  "refund_mismatch",
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
  source: "operator" | "stripe";
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
  ratings: AdminFeedbackItem[];
  earnings: AdminRideEarnings;
}

export interface AdminRideEarnings {
  record: {
    driverName: string;
    fareCents: number;
    commissionRateBps: number;
    commissionCents: number;
    driverShareCents: number;
    policyVersion: string;
    earnedAt: string;
  } | null;
  entries: EarningEntryView[];
  tip: {
    id: string;
    amountCents: number;
    status: TipStatus;
    refundedCents: number;
    stripePaymentIntentId: string | null;
    lastError: string | null;
    createdAt: string;
    paidAt: string | null;
  } | null;
  tipRefunds: AdminRefund[];
  tipRefundable: RefundableSummary | null;
  disputes: AdminDispute[];
  reconciliation: { ok: boolean; issues: string[] };
}

export interface AdminDispute {
  stripeDisputeId: string;
  subject: "fare" | "tip" | "unknown";
  status: string;
  reason: string | null;
  amountCents: number;
  currency: string;
  fundsWithdrawnCents: number;
  fundsReinstatedCents: number;
  needsReview: boolean;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export const adminTipRefundSchema = z.strictObject({
  amountCents: z.number().int().positive(),
  reason: z.string().trim().min(3).max(200),
  expectedMaxRefundableCents: z.number().int().min(0),
  idempotencyKey: z.uuid(),
});

export const feedbackStatuses = ["pending", "reviewed", "removed"] as const;
export type FeedbackStatus = (typeof feedbackStatuses)[number];

export const adminFeedbackQuerySchema = adminListQuerySchema.extend({
  status: z.enum([...feedbackStatuses, "all"]).default("pending"),
  rideId: z.uuid().optional(),
});

export const feedbackModerationSchema = z.strictObject({
  action: z.enum(["reviewed", "remove", "restore"]),
  note: z.string().trim().min(3).max(500),
  expectedVersion: z.number().int().min(1),
});

export interface AdminFeedbackItem {
  id: string;
  rideId: string;
  raterRole: "passenger" | "driver";
  rater: { name: string | null; account: string };
  ratee: { name: string | null; account: string };
  stars: number;
  comment: string | null;
  status: "none" | FeedbackStatus;
  version: number;
  editCount: number;
  moderationNote: string | null;
  moderatedBy: string | null;
  moderatedAt: string | null;
  createdAt: string;
  updatedAt: string;
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

export const TIP_RULES = {
  minCents: 100,
  maxCents: 5000,
  windowDays: 7,
  suggestedPercents: [15, 20, 25],
} as const;

export const tipStatuses = [
  "creating",
  "pending",
  "requires_action",
  "processing",
  "failed",
  "succeeded",
  "canceled",
] as const;
export type TipStatus = (typeof tipStatuses)[number];

export const tipCreateSchema = z.strictObject({
  amountCents: z.number().int().min(TIP_RULES.minCents).max(TIP_RULES.maxCents),
  idempotencyKey: z.uuid(),
  consent: z.literal(true),
});

export type TipIneligibleReason =
  | "not_completed"
  | "payment_pending"
  | "simulated"
  | "no_driver"
  | "window_closed"
  | "already_tipped";

export interface TipView {
  id: string;
  amountCents: number;
  currency: "usd";
  status: TipStatus;
  refundedCents: number;
  lastError: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface TipState {
  eligible: boolean;
  reason: TipIneligibleReason | null;
  minCents: number;
  maxCents: number;
  suggestionsCents: number[];
  driverName: string | null;
  tipBy: string | null;
  tip: TipView | null;
}

export interface TipCheckout {
  tip: TipView;
  paymentIntentClientSecret: string;
  customerId: string;
  customerEphemeralKeySecret: string;
}

export const earningsQuerySchema = z.strictObject({
  from: isoDate.optional(),
  to: isoDate.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type EarningEntryKind =
  | "ride_earning"
  | "tip"
  | "fare_refund_adjustment"
  | "tip_refund_adjustment"
  | "dispute_withdrawal"
  | "dispute_reinstatement";

export interface EarningEntryView {
  kind: EarningEntryKind;
  grossCents: number;
  commissionCents: number;
  driverAmountCents: number;
  policyVersion: string;
  occurredAt: string;
}

export interface CommissionPolicyView {
  version: string;
  fareCommissionBps: number;
  tipCommissionBps: number;
  label: string;
}

export interface EarningsSummary {
  from: string | null;
  to: string | null;
  currency: "usd";
  confirmed: {
    rides: number;
    fareCents: number;
    commissionCents: number;
    driverShareCents: number;
    tipsCents: number;
    adjustmentsCents: number;
    disputesCents: number;
    netCents: number;
  };
  disputes: { open: number };
  pending: {
    rides: number;
    fareCents: number;
    tips: number;
    tipsCents: number;
  };
  policy: CommissionPolicyView;
  payouts: { available: false; message: string };
}

export interface DriverEarningRide {
  rideId: string;
  completedAt: string | null;
  pickupAddress: string;
  destinationAddress: string;
  state: "confirmed" | "pending" | "not_charged";
  currency: "usd";
  fareCents: number;
  commissionRateBps: number | null;
  commissionCents: number | null;
  driverShareCents: number | null;
  policyVersion: string | null;
  tip: {
    amountCents: number;
    status: "paid" | "processing";
    refundedCents: number;
  } | null;
  adjustmentsCents: number;
  disputesCents: number;
  disputeOpen: boolean;
  netCents: number;
  entries: EarningEntryView[];
}

export const safetyCategories = [
  "unsafe_driving",
  "harassment",
  "vehicle_mismatch",
  "accident",
  "other",
] as const;
export type SafetyCategory = (typeof safetyCategories)[number];

export const safetyStatuses = [
  "open",
  "in_review",
  "resolved",
  "dismissed",
] as const;
export type SafetyReportStatus = (typeof safetyStatuses)[number];

export const SAFETY_RULES = {
  descriptionMinLength: 10,
  descriptionMaxLength: 2000,
  reportWindowDays: 7,
  evidenceRetentionDays: 180,
  shareTtlMinutes: 240,
  shareAfterTripMinutes: 30,
  maxActiveShares: 3,
} as const;

const SAFETY_CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/;

const safetyDescription = z
  .string()
  .max(SAFETY_RULES.descriptionMaxLength * 2)
  .transform((s) => s.replace(/\r\n?/g, "\n").trim())
  .pipe(
    z
      .string()
      .min(SAFETY_RULES.descriptionMinLength)
      .max(SAFETY_RULES.descriptionMaxLength)
      .refine((s) => !SAFETY_CONTROL.test(s), {
        message: "Descriptions can't contain control characters.",
      }),
  );

export const safetyReportSchema = z.strictObject({
  category: z.enum(safetyCategories),
  description: safetyDescription,
  clientReportId: z.uuid(),
});

export const messageReportSchema = z.strictObject({
  category: z.enum(safetyCategories),
  description: safetyDescription.optional(),
  clientReportId: z.uuid(),
});

export interface MySafetyReport {
  id: string;
  rideId: string;
  category: SafetyCategory;
  status: SafetyReportStatus;
  reportedMessages: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface TripShareView {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  active: boolean;
  views: number;
}

export interface TripShareCreated {
  share: TripShareView;
  token: string;
  path: string;
}

export interface SafetyView {
  rideId: string;
  role: "passenger" | "driver";
  currentParticipant: boolean;
  status: RideStatus;
  driver: { name: string; vehicle: string; plate: string } | null;
  passengerName: string | null;
  canReport: boolean;
  reportBy: string | null;
  reports: MySafetyReport[];
  canShare: boolean;
  shares: TripShareView[];
}

export type SharedTripStatus =
  | "searching"
  | "driver_on_the_way"
  | "driver_arrived"
  | "in_progress"
  | "completed"
  | "ended";

export interface SharedTripView {
  status: SharedTripStatus;
  driver: { firstName: string; vehicle: string; plate: string } | null;
  destination: string | null;
  driverLocation: {
    latitude: number;
    longitude: number;
    recordedAt: string;
    freshness: "live" | "recent";
  } | null;
  expiresAt: string;
  serverTime: string;
}

export const shareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const adminSafetyQuerySchema = adminListQuerySchema.extend({
  status: z.enum([...safetyStatuses, "all"]).default("open"),
  category: z.enum(safetyCategories).optional(),
  rideId: z.uuid().optional(),
});

export const safetyTriageSchema = z
  .strictObject({
    action: z.enum([
      "assign",
      "in_review",
      "resolve",
      "dismiss",
      "reopen",
      "note",
    ]),
    note: z.string().trim().min(3).max(1000).optional(),
    expectedVersion: z.number().int().min(1),
  })
  .refine(
    (t) => t.action === "assign" || t.action === "in_review" || !!t.note,
    {
      message: "A note is required for this action.",
      path: ["note"],
    },
  );

export interface AdminSafetyItem {
  id: string;
  rideId: string;
  category: SafetyCategory;
  status: SafetyReportStatus;
  reporterRole: "passenger" | "driver";
  assignedTo: string | null;
  assignedToMe: boolean;
  version: number;
  reportedMessages: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSafetyDetail extends AdminSafetyItem {
  description: string;
  reporter: { name: string | null; account: string };
  resolutionNote: string | null;
  evidenceRetainedUntil: string | null;
  closedAt: string | null;
  ride: {
    status: RideStatus;
    createdAt: string;
    completedAt: string | null;
    endedAt: string | null;
    passenger: { name: string | null; account: string };
    driver: { name: string; vehicle: string; plate: string } | null;
    rematchCount: number;
  };
  rideEvents: {
    fromStatus: string;
    toStatus: string;
    actor: string;
    reason: string | null;
    createdAt: string;
  }[];
  messages: {
    messageId: string;
    seq: number;
    senderRole: "passenger" | "driver";
    body: string | null;
    sentAt: string;
    redacted: boolean;
  }[];
  history: {
    action: string;
    actor: string;
    operator: string | null;
    fromStatus: string | null;
    toStatus: string | null;
    note: string | null;
    createdAt: string;
  }[];
}
