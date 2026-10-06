export function findDriver(
  client: unknown,
  ref: string,
): Promise<Record<string, unknown>>;
export function listDrivers(
  client: unknown,
): Promise<Record<string, unknown>[]>;
export function setDriverStatus(
  client: unknown,
  ref: string,
  status: "approved" | "suspended",
  opts?: {
    waiveDocuments?: boolean;
    reason?: string;
    categories?: string | string[];
  },
): Promise<{ id: string; display_name: string; status: string }>;
export function listCategories(
  client: unknown,
): Promise<Record<string, unknown>[]>;
export function grantOperator(
  client: unknown,
  input: {
    clerkId: string;
    displayName: string;
    permissions?: string;
    grantedBy: string;
  },
): Promise<{
  id: string;
  display_name: string;
  can_view: boolean;
  can_support: boolean;
  can_refund: boolean;
  can_verify: boolean;
  can_configure: boolean;
}>;
export function revokeOperator(
  client: unknown,
  input: { clerkId: string; grantedBy: string; reason?: string },
): Promise<{ id: string; display_name: string }>;
export function listOperators(
  client: unknown,
): Promise<Record<string, unknown>[]>;
export function auditDriverStatus(
  client: unknown,
  actor: string,
  driverId: string,
  status: string,
  reason?: string,
): Promise<void>;
export const PERMISSIONS: string[];
