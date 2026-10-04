import { z } from "zod";

export const languages = ["en", "sq"] as const;
export type Language = (typeof languages)[number];

export const savedPlaceKinds = ["home", "work", "custom"] as const;
export type SavedPlaceKind = (typeof savedPlaceKinds)[number];

export const PLACES_RULES = {
  maxCustom: 20,
  labelMax: 40,
  addressMax: 300,
} as const;

const labelSchema = z
  .string()
  .trim()
  .min(1)
  .max(PLACES_RULES.labelMax)
  .regex(/^[^<>\n\r]+$/);

const placeFields = {
  address: z.string().trim().min(1).max(PLACES_RULES.addressMax),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  providerPlaceId: z.string().trim().min(1).max(300).nullable().optional(),
};

export const savedPlaceCreateSchema = z
  .strictObject({
    kind: z.enum(savedPlaceKinds),
    label: labelSchema.nullable().optional(),
    clientPlaceId: z.uuid().optional(),
    ...placeFields,
  })
  .refine((p) => p.kind !== "custom" || !!p.label, {
    message: "Give this place a name.",
    path: ["label"],
  })
  .refine((p) => p.kind !== "custom" || !!p.clientPlaceId, {
    message: "clientPlaceId is required for named places.",
    path: ["clientPlaceId"],
  });

export const savedPlaceUpdateSchema = z
  .strictObject({
    label: labelSchema.optional(),
    address: placeFields.address.optional(),
    latitude: placeFields.latitude.optional(),
    longitude: placeFields.longitude.optional(),
    providerPlaceId: placeFields.providerPlaceId,
  })
  .refine(
    (p) =>
      (p.address === undefined) === (p.latitude === undefined) &&
      (p.latitude === undefined) === (p.longitude === undefined),
    { message: "Send the address together with its coordinates." },
  )
  .refine((p) => p.label !== undefined || p.address !== undefined, {
    message: "Nothing to change.",
  });

export interface SavedPlace {
  id: string;
  kind: SavedPlaceKind;
  label: string | null;
  address: string;
  latitude: number;
  longitude: number;
  providerPlaceId: string | null;
  updatedAt: string;
}

export interface PlacesView {
  places: SavedPlace[];
  customRemaining: number;
}

export const profileUpdateSchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[^<>\n\r]+$/)
      .optional(),
    language: z.enum(languages).optional(),
  })
  .refine((p) => p.name !== undefined || p.language !== undefined, {
    message: "Nothing to change.",
  });

export interface AccountProfile {
  name: string | null;
  language: Language | null;
  driver: { status: string; displayName: string } | null;
  isOperator: boolean;
}

export const notificationCategories = [
  "ride",
  "chat",
  "offer",
  "account",
  "support",
  "safety",
] as const;
export type NotificationCategory = (typeof notificationCategories)[number];

export interface InboxItem {
  id: string;
  kind: string;
  category: NotificationCategory;
  title: string;
  body: string;
  target: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface InboxPage {
  items: InboxItem[];
  nextCursor: string | null;
  unread: number;
}

export const inboxQuerySchema = z.strictObject({
  cursor: z
    .string()
    .regex(/^\d{1,18}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const inboxReadSchema = z.union([
  z.strictObject({ all: z.literal(true) }),
  z.strictObject({
    ids: z
      .array(z.string().regex(/^\d{1,18}$/))
      .min(1)
      .max(100),
  }),
]);

export const notificationPreferencesSchema = z.strictObject({
  rideUpdates: z.boolean(),
  chatMessages: z.boolean(),
  rideOffers: z.boolean(),
  accountUpdates: z.boolean(),
});
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;

export const SUPPORT_RULES = {
  messageMax: 1000,
  userMessagesPerRequest: 50,
  burstWindowSeconds: 60,
  burstLimit: 5,
  attachmentMinBytes: 100,
  attachmentMaxBytes: 5 * 1024 * 1024,
  attachmentsPerMessage: 3,
  attachmentsPerRequest: 10,
  pendingAttachmentsPerUser: 6,
  attachmentUploadUrlSeconds: 300,
  attachmentUploadKeyGraceSeconds: 600,
  attachmentReservationSeconds: 3600,
  attachmentViewUrlSeconds: 60,
  abandonedAttachmentHours: 24,
  attachmentRetentionDays: 90,
} as const;

export const supportAttachmentTypes = ["image/jpeg", "image/png"] as const;
export type SupportAttachmentType = (typeof supportAttachmentTypes)[number];

export const supportRoles = ["passenger", "driver"] as const;
export type SupportRole = (typeof supportRoles)[number];

export const supportMessageSchema = z.strictObject({
  body: z.string().trim().min(1).max(SUPPORT_RULES.messageMax),
  clientMessageId: z.uuid(),
});

export const supportListQuerySchema = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type SupportStatus = "open" | "in_progress" | "resolved";

export interface MySupportRequest {
  id: string;
  rideId: string;
  category: string;
  status: SupportStatus;
  destination: string;
  createdAt: string;
  updatedAt: string;
  unread: boolean;
}

export interface SupportMessageView {
  id: string;
  author: "user" | "operator";
  body: string;
  createdAt: string;
}

export interface SupportConversation extends MySupportRequest {
  message: string;
  resolutionMessage: string | null;
  resolvedAt: string | null;
  messages: SupportMessageView[];
  canReply: boolean;
}

export interface AdminBadges {
  review: number | null;
  financial: number | null;
  support: number | null;
  safety: number | null;
  drivers: number | null;
}

export type DeletionBlocker =
  | "ACTIVE_RIDE"
  | "ACTIVE_DRIVER_RIDE"
  | "DRIVER_ONLINE"
  | "PAYMENT_IN_PROGRESS"
  | "OPERATOR_ACCOUNT";

export interface DeletionStatus {
  blockers: DeletionBlocker[];
  reauthRequired: boolean;
}

export const accountDeletionSchema = z.strictObject({
  confirm: z.literal("DELETE"),
});

export interface AccountDeletionResult {
  status: "completed" | "pending";
}

export const historyQuerySchema = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
