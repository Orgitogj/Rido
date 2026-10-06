import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";

import { Pool } from "pg";
import Stripe from "stripe";

import { clerkAuthenticator } from "../../server/auth";
import { type Deps, type Handler, route } from "../../server/http";
import { stripeGateway } from "../../server/payments";
import {
  type Point,
  type RoutingProvider,
  RoutingUnavailableError,
} from "../../server/routing";
import { haversineMeters } from "../../shared/geo";
import { DEFAULT_VEHICLE_CATEGORY_ID } from "../../shared/vehicleCategory";

import type { IdentityAdmin } from "../../server/account";
import type {
  PushGateway,
  PushMessage,
  PushReceipt,
  PushTicket,
} from "../../server/notifications";
import type {
  DisputeSnapshot,
  IntentSnapshot,
  PaymentGateway,
  RefundSnapshot,
} from "../../server/payments";
import type {
  DocumentStorage,
  PresignedRequest,
  StoredObject,
  UploadMethod,
  UploadTarget,
} from "../../server/storage";
import type { DocumentUploadTarget } from "../../shared/contracts";

export function testDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url)
    throw new Error("TEST_DATABASE_URL missing: run tests through `npm test`.");
  const max = Number(process.env.TEST_DB_POOL_MAX ?? 1);
  return new Pool({ connectionString: url, max });
}

export const TEST_AREA_BOUNDARY: [number, number][] = [
  [37.6, -122.6],
  [37.6, -122.3],
  [37.95, -122.3],
  [37.95, -122.6],
];

export const TEST_POLICY = {
  base_cents: 250,
  per_km_cents: 120,
  per_minute_cents: 30,
  minimum_fare_cents: 500,
};

export async function resetDb(db: Pool) {
  await db.query(
    `TRUNCATE mobility.stripe_events, mobility.push_tickets, mobility.notifications,
       mobility.push_tokens, mobility.ride_routes, mobility.ride_events,
       mobility.ride_offers, mobility.match_rankings, mobility.rides, mobility.quotes,
       mobility.fare_policies, mobility.service_area_events, mobility.service_areas,
       mobility.routing_usage, mobility.driver_profiles, mobility.users CASCADE`,
  );
  await db.query(
    "DELETE FROM mobility.vehicle_category_events WHERE vehicle_category_id <> $1",
    [DEFAULT_VEHICLE_CATEGORY_ID],
  );
  await db.query(
    "DELETE FROM mobility.vehicle_categories WHERE NOT is_default",
  );
  await db.query(
    `UPDATE mobility.vehicle_categories
        SET name = 'Standard', capacity = 4, status = 'active', version = 1
      WHERE is_default`,
  );
  await db.query(
    `WITH area AS (
       INSERT INTO mobility.service_areas
         (code, name, status, boundary, min_latitude, max_latitude, min_longitude,
          max_longitude, dropoff_rule, is_development, created_at, updated_at)
       VALUES ('test-sf', 'Test area (automated tests only)', 'active', $1,
               37.6, 37.95, -122.6, -122.3, 'inside_area', true, now(), now())
       RETURNING id)
     INSERT INTO mobility.fare_policies
       (service_area_id, version, label, is_development, base_cents, per_km_cents,
        per_minute_cents, minimum_fare_cents, effective_from, reason, created_at)
     SELECT id, 1, 'Test policy', true, $2, $3, $4, $5, '2000-01-01T00:00:00Z',
            'automated test fixture', now()
       FROM area`,
    [
      JSON.stringify(TEST_AREA_BOUNDARY),
      TEST_POLICY.base_cents,
      TEST_POLICY.per_km_cents,
      TEST_POLICY.per_minute_cents,
      TEST_POLICY.minimum_fare_cents,
    ],
  );
}

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const otherKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const TEST_JWT_PUBLIC_KEY = publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

const b64url = (value: object | Buffer) =>
  (Buffer.isBuffer(value)
    ? value
    : Buffer.from(JSON.stringify(value))
  ).toString("base64url");

export function sessionToken(
  clerkId: string,
  opts: {
    expiresInSeconds?: number;
    signWithOtherKey?: boolean;
    factorAgeMinutes?: number;
  } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: "ins_test" };
  const payload = {
    sub: clerkId,
    sid: `sess_${clerkId}`,
    iss: "https://clerk.test.local",
    iat: now - 5,
    nbf: now - 5,
    exp: now + (opts.expiresInSeconds ?? 60),
    ...(opts.factorAgeMinutes === undefined
      ? {}
      : { fva: [opts.factorAgeMinutes, -1] }),
  };
  const input = `${b64url(header)}.${b64url(payload)}`;
  const signature = createSign("RSA-SHA256")
    .update(input)
    .sign(opts.signWithOtherKey ? otherKeys.privateKey : privateKey);
  return `${input}.${b64url(signature)}`;
}

export const WEBHOOK_SECRET = "whsec_test_secret";
const stripeForSigning = new Stripe("sk_test_signing_only");

export function signWebhook(event: object) {
  const payload = JSON.stringify(event);
  const header = stripeForSigning.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { payload, header };
}

export class FakeStripe implements PaymentGateway {
  intents = new Map<string, IntentSnapshot>();
  intentKeys = new Map<string, string>();
  customers = new Map<string, string>();
  calls = {
    createRefund: 0,
    createIntent: 0,
    retrieveIntent: 0,
    createCustomer: 0,
    capture: 0,
    cancel: 0,
  };
  failNext: { capture?: boolean; cancel?: boolean } = {};
  private seq = 0;
  private real = stripeGateway();

  deletedCustomers: string[] = [];
  customerDeleteFails = false;
  async deleteCustomer(id: string) {
    if (this.customerDeleteFails) throw new Error("stripe unavailable");
    this.deletedCustomers.push(id);
  }

  async createCustomer(_input: { userId: string }, key: string) {
    this.calls.createCustomer++;
    if (!this.customers.has(key)) this.customers.set(key, `cus_${++this.seq}`);
    return { id: this.customers.get(key)! };
  }

  async createPaymentIntent(
    input: {
      amount: number;
      currency: string;
      customer: string;
      metadata: Record<string, string>;
      captureMethod?: "manual" | "automatic";
      description?: string;
    },
    key: string,
  ) {
    this.calls.createIntent++;
    const existing = this.intentKeys.get(key);
    if (existing) return { ...this.intents.get(existing)! };
    const id = `pi_${++this.seq}`;
    this.intentInputs.set(id, {
      captureMethod: input.captureMethod,
      description: input.description,
      customer: input.customer,
    });
    this.intents.set(id, {
      id,
      status: "requires_payment_method",
      amount: input.amount,
      currency: input.currency,
      client_secret: `${id}_secret_test`,
      metadata: input.metadata,
      hasPaymentError: false,
      amountReceived: 0,
      cancellationReason: null,
      captureBefore: null,
    });
    this.intentKeys.set(key, id);
    return { ...this.intents.get(id)! };
  }

  async retrievePaymentIntent(id: string) {
    this.calls.retrieveIntent++;
    const intent = this.intents.get(id);
    if (!intent) throw new Error(`No such payment_intent: ${id}`);
    return { ...intent };
  }

  captureKeys = new Set<string>();
  effectiveCaptures = 0;

  async capturePaymentIntent(id: string, key: string) {
    this.calls.capture++;
    this.captureKeys.add(key);
    if (this.failNext.capture) {
      this.failNext.capture = false;
      throw new Error("Stripe unavailable");
    }
    const intent = this.intents.get(id)!;
    if (intent.status === "succeeded") return { ...intent };
    if (intent.status !== "requires_capture") {
      throw new Error(`Cannot capture a ${intent.status} PaymentIntent`);
    }
    this.setIntent(id, {
      status: "succeeded",
      amountReceived: intent.amount,
    });
    this.effectiveCaptures++;
    return { ...this.intents.get(id)! };
  }

  async cancelPaymentIntent(id: string, _key: string) {
    this.calls.cancel++;
    if (this.failNext.cancel) {
      this.failNext.cancel = false;
      throw new Error("Stripe unavailable");
    }
    const intent = this.intents.get(id)!;
    if (intent.status === "canceled") return { ...intent };
    if (intent.status === "succeeded") {
      throw new Error("Cannot cancel a succeeded PaymentIntent");
    }
    this.setIntent(id, { status: "canceled" });
    return { ...this.intents.get(id)! };
  }

  holdSeconds = 7 * 24 * 3600;
  clock: { now: Date } | null = null;

  authorize(id: string) {
    const now = (this.clock?.now ?? new Date()).getTime();
    this.setIntent(id, {
      status: "requires_capture",
      hasPaymentError: false,
      captureBefore: Math.floor(now / 1000) + this.holdSeconds,
    });
  }

  expireHold(id: string) {
    this.setIntent(id, { status: "canceled", cancellationReason: "automatic" });
  }

  refunds = new Map<string, RefundSnapshot>();
  refundKeys = new Map<string, string>();
  refundMode: "succeed" | "pending" | "reject" | "down" = "succeed";

  async createRefund(
    input: {
      paymentIntentId: string;
      amount: number;
      metadata: Record<string, string>;
    },
    key: string,
  ): Promise<RefundSnapshot> {
    this.calls.createRefund++;
    if (this.refundMode === "down") throw new Error("Stripe unavailable");
    if (this.refundMode === "reject") {
      throw Object.assign(new Error("Charge already refunded"), {
        statusCode: 400,
      });
    }
    const existing = this.refundKeys.get(key);
    if (existing) return { ...this.refunds.get(existing)! };
    const intent = this.intents.get(input.paymentIntentId)!;
    const already = [...this.refunds.values()]
      .filter(
        (r) =>
          r.paymentIntentId === input.paymentIntentId && r.status !== "failed",
      )
      .reduce((sum, r) => sum + r.amount, 0);
    if (already + input.amount > intent.amountReceived) {
      throw Object.assign(new Error("Refund exceeds charge"), {
        statusCode: 400,
      });
    }
    const id = `re_${++this.refundSeq}`;
    this.refunds.set(id, {
      id,
      status: this.refundMode === "pending" ? "pending" : "succeeded",
      amount: input.amount,
      paymentIntentId: input.paymentIntentId,
      failureReason: null,
    });
    this.refundKeys.set(key, id);
    return { ...this.refunds.get(id)! };
  }

  private refundSeq = 0;

  async retrieveRefund(id: string): Promise<RefundSnapshot> {
    return { ...this.refunds.get(id)! };
  }

  disputes = new Map<string, DisputeSnapshot>();
  private disputeSeq = 0;
  private txnSeq = 0;

  openDispute(
    paymentIntentId: string,
    opts: { status?: string; reason?: string; amount?: number } = {},
  ) {
    const intent = this.intents.get(paymentIntentId)!;
    const id = `dp_${++this.disputeSeq}`;
    this.disputes.set(id, {
      id,
      status: opts.status ?? "needs_response",
      amount: opts.amount ?? intent.amountReceived,
      currency: intent.currency,
      reason: opts.reason ?? "fraudulent",
      paymentIntentId,
      balanceTransactions: [],
    });
    return id;
  }

  withdrawDispute(id: string, amount?: number) {
    const d = this.disputes.get(id)!;
    d.balanceTransactions.push({
      id: `txn_${++this.txnSeq}`,
      amount: -(amount ?? d.amount),
    });
  }

  reinstateDispute(id: string, amount?: number) {
    const d = this.disputes.get(id)!;
    d.balanceTransactions.push({
      id: `txn_${++this.txnSeq}`,
      amount: amount ?? d.amount,
    });
  }

  setDispute(id: string, patch: Partial<DisputeSnapshot>) {
    this.disputes.set(id, { ...this.disputes.get(id)!, ...patch });
  }

  async retrieveDispute(id: string): Promise<DisputeSnapshot> {
    const d = this.disputes.get(id);
    if (!d) throw new Error(`No such dispute: ${id}`);
    return { ...d, balanceTransactions: [...d.balanceTransactions] };
  }

  async listDisputes(paymentIntentId: string): Promise<DisputeSnapshot[]> {
    return [...this.disputes.values()]
      .filter((d) => d.paymentIntentId === paymentIntentId)
      .map((d) => ({ ...d, balanceTransactions: [...d.balanceTransactions] }));
  }

  async listRefunds(paymentIntentId: string): Promise<RefundSnapshot[]> {
    return [...this.refunds.values()]
      .filter((r) => r.paymentIntentId === paymentIntentId)
      .map((r) => ({ ...r }));
  }

  intentInputs = new Map<
    string,
    { captureMethod?: string; description?: string; customer: string }
  >();

  pay(id: string) {
    const intent = this.intents.get(id)!;
    this.setIntent(id, {
      status: "succeeded",
      hasPaymentError: false,
      amountReceived: intent.amount,
    });
  }

  decline(id: string) {
    this.setIntent(id, {
      status: "requires_payment_method",
      hasPaymentError: true,
    });
  }

  setRefund(id: string, patch: Partial<RefundSnapshot>) {
    this.refunds.set(id, { ...this.refunds.get(id)!, ...patch });
  }

  async createEphemeralKey(_customerId: string) {
    return { secret: `ek_test_${randomUUID()}` };
  }

  parseWebhook(rawBody: string, signature: string) {
    return this.real.parseWebhook(rawBody, signature);
  }

  setIntent(id: string, patch: Partial<IntentSnapshot>) {
    this.intents.set(id, { ...this.intents.get(id)!, ...patch });
  }

  onlyIntent() {
    expect(this.intents.size).toBe(1);
    return [...this.intents.values()][0];
  }
}

export const pointKey = (p: Point) =>
  `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`;

export class FakeRouting implements RoutingProvider {
  source = "test_provider" as const;
  calls: { from: Point; to: Point; via: Point[] }[] = [];
  unreachable = new Set<string>();
  matrixCalls: { origins: Point[]; destination: Point }[] = [];
  fail = false;
  noRoute = false;
  matrixFail = false;
  durationSeconds = 420;
  distanceMeters = 3100;
  matrixDurations = new Map<string, number | null>();
  async route(from: Point, to: Point, via: Point[] = []) {
    this.calls.push({ from, to, via });
    if (this.fail) throw new RoutingUnavailableError("routing unavailable");
    if (this.noRoute) return null;
    if ([from, ...via, to].some((p) => this.unreachable.has(pointKey(p)))) {
      return null;
    }
    return {
      durationSeconds: this.durationSeconds * (1 + via.length),
      distanceMeters: this.distanceMeters * (1 + via.length),
      polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
    };
  }
  async routeMatrix(origins: Point[], destination: Point) {
    this.matrixCalls.push({ origins, destination });
    if (this.matrixFail)
      throw new RoutingUnavailableError("matrix unavailable");
    return origins.map((o, originIndex) => {
      const key = pointKey(o);
      const fixed = this.matrixDurations.has(key)
        ? this.matrixDurations.get(key)!
        : Math.round((haversineMeters(o, destination) * 1.3) / (25_000 / 3600));
      return {
        originIndex,
        reachable: fixed !== null,
        durationSeconds: fixed,
        distanceMeters:
          fixed === null
            ? null
            : Math.round(haversineMeters(o, destination) * 1.3),
      };
    });
  }
}

export class FakePush implements PushGateway {
  sent: PushMessage[] = [];
  expiredTokens = new Set<string>();
  receiptErrors = new Map<string, string>();
  down = false;
  private seq = 0;
  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (this.down) throw new Error("push service unavailable");
    return messages.map((m) => {
      if (this.expiredTokens.has(m.to)) {
        return {
          status: "error" as const,
          message: "not registered",
          details: { error: "DeviceNotRegistered" },
        };
      }
      this.sent.push(m);
      return { status: "ok" as const, id: `ticket-${++this.seq}` };
    });
  }
  async receipts(ids: string[]): Promise<Record<string, PushReceipt>> {
    return Object.fromEntries(
      ids.map((id) => [
        id,
        this.receiptErrors.has(id)
          ? {
              status: "error" as const,
              details: { error: this.receiptErrors.get(id) },
            }
          : { status: "ok" as const },
      ]),
    );
  }
  to(token: string) {
    return this.sent.filter((m) => m.to === token);
  }
}

export class FakeStorage implements DocumentStorage {
  objects = new Map<
    string,
    { bytes: Uint8Array; contentType: string; etag: string }
  >();
  removed: string[] = [];
  down = false;
  uploadMethod: UploadMethod = "POST";
  hooks: {
    afterHead?: (key: string) => Promise<void> | void;
    beforeCopy?: (from: string, to: string) => Promise<void> | void;
  } = {};
  private seq = 0;

  presignUpload(
    key: string,
    contentType: string,
    sizeBytes: number,
    expiresSeconds: number,
    now: Date,
  ): UploadTarget {
    const expiresAt = new Date(now.getTime() + expiresSeconds * 1000);
    if (this.uploadMethod === "POST") {
      return {
        method: "POST",
        url: "https://storage.test/bucket/",
        fields: {
          key,
          "Content-Type": contentType,
          policy: `size=${sizeBytes}`,
        },
        expiresAt,
      };
    }
    return {
      method: "PUT",
      url: `https://storage.test/put/${key}?expires=${expiresSeconds}`,
      headers: {
        "content-type": contentType,
        "content-length": String(sizeBytes),
      },
      expiresAt,
    };
  }

  presignDownload(
    key: string,
    expiresSeconds: number,
    now: Date,
  ): PresignedRequest {
    return {
      url: `https://storage.test/get/${key}?expires=${expiresSeconds}`,
      method: "GET",
      headers: {},
      expiresAt: new Date(now.getTime() + expiresSeconds * 1000),
    };
  }

  put(key: string, bytes: Uint8Array, contentType: string) {
    this.objects.set(key, { bytes, contentType, etag: `"etag-${++this.seq}"` });
    return key;
  }

  upload(
    target: DocumentUploadTarget | string,
    bytes: Uint8Array,
    contentType: string,
  ) {
    const key =
      typeof target === "string"
        ? new URL(target).pathname.replace(/^\/put\//, "")
        : target.method === "POST"
          ? target.fields.key
          : new URL(target.url).pathname.replace(/^\/put\//, "");
    return this.put(key, bytes, contentType);
  }

  fetchView(url: string) {
    return (
      this.objects.get(new URL(url).pathname.replace(/^\/get\//, ""))?.bytes ??
      null
    );
  }

  async head(key: string): Promise<StoredObject | null> {
    if (this.down) throw new Error("storage unavailable");
    const o = this.objects.get(key);
    const result = o
      ? { size: o.bytes.length, contentType: o.contentType, etag: o.etag }
      : null;
    await this.hooks.afterHead?.(key);
    return result;
  }

  async readStart(
    key: string,
    bytes: number,
    etag: string,
  ): Promise<Uint8Array | null> {
    if (this.down) throw new Error("storage unavailable");
    const o = this.objects.get(key);
    if (!o || o.etag !== etag) return null;
    return o.bytes.slice(0, bytes);
  }

  async copy(from: string, to: string, etag: string): Promise<boolean> {
    if (this.down) throw new Error("storage unavailable");
    await this.hooks.beforeCopy?.(from, to);
    const o = this.objects.get(from);
    if (!o || o.etag !== etag) return false;
    this.objects.set(to, { ...o, bytes: o.bytes.slice() });
    return true;
  }

  async remove(key: string): Promise<void> {
    if (this.down) throw new Error("storage unavailable");
    this.objects.delete(key);
    this.removed.push(key);
  }
}

export class FakeIdentity implements IdentityAdmin {
  deleted: string[] = [];
  fail = false;
  async deleteUser(clerkId: string) {
    if (this.fail) throw new Error("clerk unavailable");
    this.deleted.push(clerkId);
  }
}

export interface TestContext {
  db: Pool;
  stripe: FakeStripe;
  routing: FakeRouting;
  push: FakePush;
  storage: FakeStorage;
  identity: FakeIdentity;
  clock: { now: Date };
  onSleep: (() => Promise<void> | void) | null;
  deps: Deps;
}

export function createContext(db: Pool): TestContext {
  process.env.CLERK_JWT_KEY = TEST_JWT_PUBLIC_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_signing_only";
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const stripe = new FakeStripe();
  const routing = new FakeRouting();
  stripe.clock = null;
  const push = new FakePush();
  const storage = new FakeStorage();
  const identity = new FakeIdentity();
  const clock = { now: new Date() };
  stripe.clock = clock;
  const ctx = {
    db,
    stripe,
    routing,
    push,
    storage,
    identity,
    clock,
    onSleep: null,
  } as unknown as TestContext;
  ctx.deps = {
    db,
    authenticate: clerkAuthenticator(process.env),
    payments: stripe,
    routing,
    push,
    storage,
    identity,
    now: () => clock.now,
    sleep: async (ms: number) => {
      clock.now = new Date(clock.now.getTime() + ms);
      const hook = ctx.onSleep;
      ctx.onSleep = null;
      if (hook) await hook();
    },
  };
  return ctx;
}

export async function call<P>(
  ctx: TestContext,
  handler: Handler<P>,
  opts: {
    method?: string;
    user?: string;
    factorAgeMinutes?: number;
    token?: string;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
    params?: P;
    url?: string;
  } = {},
) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token !== undefined) headers.authorization = opts.token;
  else if (opts.user)
    headers.authorization = `Bearer ${sessionToken(opts.user, { factorAgeMinutes: opts.factorAgeMinutes })}`;
  let body: string | undefined = opts.rawBody;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] ??= "application/json";
  }
  const request = new Request(opts.url ?? "http://localhost/api/test", {
    method: opts.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body,
  });
  const response = await route(handler, () => ctx.deps)(
    request,
    (opts.params ?? {}) as P,
  );
  const json = await response.json();
  return { status: response.status, json, response };
}

export const PICKUP = {
  address: "Market St, San Francisco",
  latitude: 37.7749,
  longitude: -122.4194,
};
export const DESTINATION = {
  address: "Mission St, San Francisco",
  latitude: 37.7599,
  longitude: -122.4148,
};
