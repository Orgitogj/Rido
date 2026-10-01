import { randomUUID } from "node:crypto";

import {
  createPlace,
  getAccount,
  getPlaces,
  patchAccount,
  patchPlace,
  removePlace,
} from "../../server/routes/profile";
import { createQuote } from "../../server/routes/quotes";
import {
  PLACES_RULES,
  type PlacesView,
  type SavedPlace,
} from "../../shared/account";

import {
  call,
  createContext,
  DESTINATION,
  PICKUP,
  resetDb,
  testDb,
  type TestContext,
} from "./helpers";
import {
  assertInvariants,
  assignedRide,
  drive,
  apply,
  viewRide,
} from "./scenario";

const db = testDb();
let ctx: TestContext;

beforeEach(async () => {
  await resetDb(db);
  await db.query("TRUNCATE mobility.saved_places");
  ctx = createContext(db);
});
afterEach(() => assertInvariants(ctx));
afterAll(() => db.end());

const A = "user_alice";
const B = "user_bob";
const D = "user_driver";

const home = { kind: "home", ...PICKUP };
const custom = (label: string, clientPlaceId = randomUUID()) => ({
  kind: "custom",
  label,
  clientPlaceId,
  ...DESTINATION,
});

const post = (user: string, body: unknown) =>
  call(ctx, createPlace, { user, body });
const list = async (user: string) =>
  (await call(ctx, getPlaces, { user })).json.data as PlacesView;

describe("account profile", () => {
  it("returns the caller's own profile and validates edits", async () => {
    const first = await call(ctx, getAccount, { user: A });
    expect(first.json.data).toEqual({
      name: null,
      language: null,
      driver: null,
      isOperator: false,
    });
    const ok = await call(ctx, patchAccount, {
      method: "PATCH",
      user: A,
      body: { name: "  Alice  ", language: "sq" },
    });
    expect(ok.json.data).toMatchObject({ name: "Alice", language: "sq" });
    for (const body of [
      { name: "" },
      { name: "x".repeat(101) },
      { name: "<b>A</b>" },
      { language: "de" },
      { role: "operator" },
      {},
    ]) {
      const res = await call(ctx, patchAccount, {
        method: "PATCH",
        user: A,
        body,
      });
      expect(res.status).toBe(400);
    }
    expect(
      (await call(ctx, getAccount, { user: B })).json.data.name,
    ).toBeNull();
    expect((await call(ctx, getAccount, {})).status).toBe(401);
  });

  it("doesn't change the reviewed driver name or past rides when the profile name changes", async () => {
    await call(ctx, patchAccount, {
      method: "PATCH",
      user: A,
      body: { name: "Alice" },
    });
    const rideId = await assignedRide(ctx, A, D);
    await drive(ctx, D, rideId);
    await apply(ctx, A);
    await call(ctx, patchAccount, {
      method: "PATCH",
      user: A,
      body: { name: "Changed" },
    });

    const ride = await viewRide(ctx, D, rideId);
    expect(ride.json.data.passengerName).toBe("Alice");
    const profile = (await call(ctx, getAccount, { user: A })).json.data;
    expect(profile.name).toBe("Changed");
    expect(profile.driver.displayName).toBe(`Driver ${A}`);
  });
});

describe("saved places", () => {
  it("keeps one Home per user, replacing it on a repeat", async () => {
    const first = await post(A, home);
    expect(first.status).toBe(201);
    const second = await post(A, {
      ...home,
      address: "New home",
      latitude: 37.78,
    });
    expect(second.status).toBe(200);
    expect(second.json.data.id).toBe(first.json.data.id);
    const view = await list(A);
    expect(view.places).toHaveLength(1);
    expect(view.places[0]).toMatchObject({
      kind: "home",
      label: null,
      address: "New home",
      latitude: 37.78,
    });
  });

  it("creates only one Home and one Work under concurrent requests", async () => {
    const results = await Promise.all([
      post(A, home),
      post(A, home),
      post(A, { ...home, kind: "work" }),
      post(A, { ...home, kind: "work" }),
    ]);
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(
      true,
    );
    const view = await list(A);
    expect(view.places.map((p) => p.kind).sort()).toEqual(["home", "work"]);
  });

  it("makes retries of a named place safe and enforces the limit", async () => {
    const id = randomUUID();
    const first = await post(A, custom("Gym", id));
    const retry = await post(A, custom("Gym", id));
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.json.data.id).toBe(first.json.data.id);
    for (let i = 1; i < PLACES_RULES.maxCustom; i++) {
      expect((await post(A, custom(`Place ${i}`))).status).toBe(201);
    }
    const over = await post(A, custom("One too many"));
    expect(over.status).toBe(409);
    expect(over.json.error.code).toBe("PLACE_LIMIT");
    expect((await list(A)).customRemaining).toBe(0);
    expect((await post(A, custom("Gym", id))).status).toBe(200);
    expect((await post(B, custom("Bob's"))).status).toBe(201);
  });

  it("rejects invalid, oversized and unknown fields", async () => {
    for (const body of [
      { kind: "custom", ...DESTINATION, clientPlaceId: randomUUID() },
      { kind: "custom", label: "Gym", ...DESTINATION },
      { ...home, latitude: 91 },
      { ...home, address: "x".repeat(301) },
      { ...home, userId: "someone-else" },
      { kind: "school", ...PICKUP },
      custom("x".repeat(41)),
    ]) {
      expect((await post(A, body)).status).toBe(400);
    }
    expect((await list(A)).places).toEqual([]);
  });

  it("returns 404 for another user's place and never lists it", async () => {
    const mine = (await post(A, custom("Gym"))).json.data as SavedPlace;
    const patch = await call(ctx, patchPlace, {
      method: "PATCH",
      user: B,
      params: { id: mine.id },
      body: { label: "Stolen" },
    });
    expect(patch.status).toBe(404);
    const del = await call(ctx, removePlace, {
      method: "DELETE",
      user: B,
      params: { id: mine.id },
    });
    expect(del.status).toBe(404);
    expect((await list(B)).places).toEqual([]);
    expect((await list(A)).places[0].label).toBe("Gym");
  });

  it("edits and deletes own places", async () => {
    const gym = (await post(A, custom("Gym"))).json.data as SavedPlace;
    const homePlace = (await post(A, home)).json.data as SavedPlace;
    const renamed = await call(ctx, patchPlace, {
      method: "PATCH",
      user: A,
      params: { id: gym.id },
      body: {
        label: "Pool",
        address: "New St",
        latitude: 37.77,
        longitude: -122.41,
      },
    });
    expect(renamed.json.data).toMatchObject({
      label: "Pool",
      address: "New St",
    });
    const partial = await call(ctx, patchPlace, {
      method: "PATCH",
      user: A,
      params: { id: gym.id },
      body: { address: "No coordinates" },
    });
    expect(partial.status).toBe(400);
    const renameHome = await call(ctx, patchPlace, {
      method: "PATCH",
      user: A,
      params: { id: homePlace.id },
      body: { label: "Castle" },
    });
    expect(renameHome.status).toBe(422);
    const del = await call(ctx, removePlace, {
      method: "DELETE",
      user: A,
      params: { id: gym.id },
    });
    expect(del.status).toBe(200);
    const again = await call(ctx, removePlace, {
      method: "DELETE",
      user: A,
      params: { id: gym.id },
    });
    expect(again.status).toBe(404);
    expect((await list(A)).places.map((p) => p.kind)).toEqual(["home"]);
  });

  it("still applies service-area rules to a saved place and keeps the place", async () => {
    const far = (
      await post(A, {
        kind: "work",
        address: "Outside coverage",
        latitude: 37.5,
        longitude: -122.4,
      })
    ).json.data as SavedPlace;
    const quote = await call(ctx, createQuote, {
      user: A,
      body: {
        pickup: PICKUP,
        destination: {
          address: far.address,
          latitude: far.latitude,
          longitude: far.longitude,
        },
      },
    });
    expect(quote.status).toBe(422);
    expect(quote.json.error.code).toBe("DESTINATION_OUTSIDE_SERVICE_AREA");
    expect((await list(A)).places).toHaveLength(1);
  });
});
