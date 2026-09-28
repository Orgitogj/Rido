import type { CommissionPolicyView } from "../shared/contracts";

export interface CommissionPolicy extends CommissionPolicyView {
  effectiveFrom: string;
}

export const COMMISSION_POLICIES: CommissionPolicy[] = [
  {
    version: "dev-0",
    effectiveFrom: "1970-01-01T00:00:00.000Z",
    fareCommissionBps: 0,
    tipCommissionBps: 0,
    label:
      "Development default: no platform commission has been set, so drivers keep 100% of captured fares and tips.",
  },
];

export function validatePolicies(policies: CommissionPolicy[]): string[] {
  const problems: string[] = [];
  const versions = new Set<string>();
  let previous = -Infinity;
  for (const p of policies) {
    if (versions.has(p.version))
      problems.push(`duplicate version ${p.version}`);
    versions.add(p.version);
    const at = Date.parse(p.effectiveFrom);
    if (Number.isNaN(at)) problems.push(`invalid date for ${p.version}`);
    if (at <= previous) problems.push(`${p.version} is out of order`);
    previous = at;
    for (const bps of [p.fareCommissionBps, p.tipCommissionBps]) {
      if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
        problems.push(`${p.version} has an invalid rate`);
      }
    }
  }
  if (!policies.length) problems.push("no commission policy defined");
  return problems;
}

export function policyAt(
  at: Date,
  policies: CommissionPolicy[] = COMMISSION_POLICIES,
): CommissionPolicy {
  const problems = validatePolicies(policies);
  if (problems.length) {
    throw new Error(`Invalid commission policy: ${problems.join(", ")}`);
  }
  let current = policies[0];
  for (const p of policies) {
    if (Date.parse(p.effectiveFrom) <= at.getTime()) current = p;
  }
  return current;
}

export function splitAmount(grossCents: number, rateBps: number) {
  const commissionCents = Math.floor((grossCents * rateBps + 5000) / 10_000);
  return { commissionCents, driverCents: grossCents - commissionCents };
}

export function reversalSplit(
  earning: { fare_cents: number; driver_share_cents: number },
  reversedBefore: number,
  reversedAfter: number,
) {
  const clamp = (x: number) => Math.max(0, Math.min(x, earning.fare_cents));
  const before = clamp(reversedBefore);
  const after = clamp(reversedAfter);
  const driverPortion = (x: number) =>
    Math.floor((x * earning.driver_share_cents) / earning.fare_cents);
  const grossCents = after - before;
  const driverCents = driverPortion(after) - driverPortion(before);
  return {
    grossCents,
    driverCents,
    commissionCents: grossCents - driverCents,
  };
}

export function refundSplit(
  earning: { fare_cents: number; driver_share_cents: number },
  previouslyRefundedCents: number,
  refundCents: number,
) {
  const before = Math.min(previouslyRefundedCents, earning.fare_cents);
  return reversalSplit(earning, before, before + refundCents);
}
