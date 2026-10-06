import { z } from "zod";

import { isValidTimeZone } from "./quietHours";
import { AREA_RULES, type Vertex } from "./serviceArea";

export const dropoffRules = ["inside_area", "anywhere"] as const;
export type DropoffRule = (typeof dropoffRules)[number];

const vertexSchema = z.tuple([
  z.number().finite().min(-85).max(85),
  z.number().finite().min(-180).max(180),
]);

const reasonSchema = z.string().trim().min(3).max(500);

const timezoneSchema = z.string().min(1).max(64).refine(isValidTimeZone, {
  message: "Unknown time zone.",
});

export const serviceAreaCreateSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/),
  name: z.string().trim().min(2).max(80),
  boundary: z
    .array(vertexSchema)
    .min(AREA_RULES.minVertices)
    .max(AREA_RULES.maxVertices),
  dropoffRule: z.enum(dropoffRules),
  isDevelopment: z.boolean(),
  timezone: timezoneSchema.optional(),
  reason: reasonSchema,
});

export const serviceAreaUpdateSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(80).optional(),
    boundary: z
      .array(vertexSchema)
      .min(AREA_RULES.minVertices)
      .max(AREA_RULES.maxVertices)
      .optional(),
    dropoffRule: z.enum(dropoffRules).optional(),
    status: z.enum(["active", "inactive"]).optional(),
    timezone: timezoneSchema.optional(),
    expectedVersion: z.number().int().min(1),
    reason: reasonSchema,
  })
  .refine(
    (u) =>
      u.timezone !== undefined ||
      u.name !== undefined ||
      u.boundary !== undefined ||
      u.dropoffRule !== undefined ||
      u.status !== undefined,
    { message: "Nothing to change." },
  );

const centsSchema = z.number().int().min(0).max(100_000);

export const farePolicyCreateSchema = z.strictObject({
  label: z.string().trim().min(3).max(80),
  isDevelopment: z.boolean(),
  baseCents: centsSchema,
  perKmCents: centsSchema,
  perMinuteCents: centsSchema,
  minimumFareCents: z.number().int().min(50).max(1_000_000),
  effectiveFrom: z.iso.datetime({ offset: true }),
  vehicleCategoryId: z.uuid().optional(),
  reason: reasonSchema,
});

export const farePolicyCancelSchema = z.strictObject({
  reason: reasonSchema,
});

export type FarePolicyState =
  "scheduled" | "in_effect" | "superseded" | "cancelled";

export interface FarePolicyView {
  id: string;
  vehicleCategoryId: string;
  vehicleCategoryName: string | null;
  version: number;
  label: string;
  isDevelopment: boolean;
  currency: string;
  baseCents: number;
  perKmCents: number;
  perMinuteCents: number;
  minimumFareCents: number;
  effectiveFrom: string;
  state: FarePolicyState;
  reason: string;
  createdBy: string | null;
  createdAt: string;
  cancelledBy: string | null;
  cancelReason: string | null;
  quotesUsing: number;
  examples: {
    distanceMeters: number;
    durationSeconds: number;
    fareCents: number;
  }[];
}

export interface ServiceAreaItem {
  id: string;
  code: string;
  name: string;
  status: "active" | "inactive";
  dropoffRule: DropoffRule;
  isDevelopment: boolean;
  timezone: string;
  version: number;
  vertexCount: number;
  currentPolicy: {
    version: number;
    label: string;
    isDevelopment: boolean;
  } | null;
  updatedAt: string;
}

export interface ServiceAreaDetail extends ServiceAreaItem {
  boundary: Vertex[];
  bounds: {
    minLatitude: number;
    maxLatitude: number;
    minLongitude: number;
    maxLongitude: number;
  };
  policies: FarePolicyView[];
  history: {
    action: string;
    actor: string;
    operator: string | null;
    reason: string | null;
    createdAt: string;
  }[];
}
