import { z } from "zod";

export const DEFAULT_VEHICLE_CATEGORY_ID =
  "00000000-0000-4000-8000-000000000001";

export const CATEGORY_RULES = {
  maxPassengers: 8,
  maxPerDriver: 20,
} as const;

const reason = z.string().trim().min(3).max(500);
const name = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[^<>\n\r]+$/);
const description = z
  .string()
  .trim()
  .max(300)
  .regex(/^[^<>]*$/);
const capacity = z.number().int().min(1).max(CATEGORY_RULES.maxPassengers);

export const categoryCreateSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/),
  name,
  description: description.default(""),
  capacity,
  isDevelopment: z.boolean(),
  reason,
});

export const categoryUpdateSchema = z
  .strictObject({
    name: name.optional(),
    description: description.optional(),
    capacity: capacity.optional(),
    status: z.enum(["active", "inactive"]).optional(),
    isDevelopment: z.boolean().optional(),
    expectedVersion: z.number().int().min(1),
    reason,
  })
  .refine(
    (u) =>
      u.name !== undefined ||
      u.description !== undefined ||
      u.capacity !== undefined ||
      u.status !== undefined ||
      u.isDevelopment !== undefined,
    { message: "Nothing to change." },
  );

export const driverCategoriesSchema = z.strictObject({
  categoryIds: z
    .array(z.uuid())
    .min(1)
    .max(CATEGORY_RULES.maxPerDriver)
    .refine((ids) => new Set(ids).size === ids.length),
  reason,
  expectedVersion: z.number().int().min(1),
});

export const categoryAvailabilityQuerySchema = z.strictObject({
  latitude: z.coerce.number().finite().min(-90).max(90),
  longitude: z.coerce.number().finite().min(-180).max(180),
  passengers: z.coerce
    .number()
    .int()
    .min(1)
    .max(CATEGORY_RULES.maxPassengers)
    .default(1),
});

export interface VehicleCategoryAdmin {
  id: string;
  code: string;
  name: string;
  description: string;
  capacity: number;
  status: "active" | "inactive";
  isDevelopment: boolean;
  isDefault: boolean;
  version: number;
  authorizedDrivers: number;
  areasPriced: number;
  updatedAt: string;
  history: {
    action: string;
    actor: string;
    operator: string | null;
    reason: string | null;
    createdAt: string;
  }[];
}

export interface DriverCategoryView {
  id: string;
  name: string;
  capacity: number;
  active: boolean;
}

export interface CategoryOption {
  id: string;
  name: string;
  description: string;
  capacity: number;
  isDevelopment: boolean;
  driversNearby: number;
}

export interface CategoryAvailability {
  categories: CategoryOption[];
  passengers: number;
  estimatedAt: string;
}
