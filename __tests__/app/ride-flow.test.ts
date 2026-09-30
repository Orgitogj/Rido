import { ApiRequestError, apiRequest } from "@/lib/fetch";
import { calculateRegion } from "@/lib/map";
import { tripProblem } from "@/shared/geo";

jest.mock("@clerk/expo", () => ({
  useAuth: () => ({ getToken: async () => null }),
}));
jest.mock("expo-router", () => ({ useFocusEffect: jest.fn() }));

const pickup = { address: "A", latitude: 37.7749, longitude: -122.4194 };
const destination = { address: "B", latitude: 37.7599, longitude: -122.4148 };
const empty = { address: null, latitude: null, longitude: null };

describe("tripProblem (Find Now guard)", () => {
  it("requires both pickup and destination", () => {
    expect(tripProblem(empty, destination)).toMatch(/pickup/i);
    expect(tripProblem(pickup, empty)).toMatch(/destination/i);
  });

  it("rejects the same place and accepts a real trip", () => {
    expect(tripProblem(pickup, { ...pickup, address: "A again" })).toMatch(
      /too close/,
    );
    expect(tripProblem(pickup, destination)).toBeNull();
  });

  it("treats zero coordinates as valid, not missing", () => {
    expect(
      tripProblem(
        { address: "Null Island", latitude: 0, longitude: 0 },
        { address: "East", latitude: 0, longitude: 0.05 },
      ),
    ).toBeNull();
  });

  it("rejects out-of-range coordinates", () => {
    expect(tripProblem({ ...pickup, latitude: 120 }, destination)).toMatch(
      /couldn't be resolved/,
    );
  });
});

describe("calculateRegion", () => {
  it("centres on zero coordinates instead of falling back to the default city", () => {
    const region = calculateRegion({ userLatitude: 0, userLongitude: 0 });
    expect(region.latitude).toBe(0);
    expect(region.longitude).toBe(0);
  });
});

describe("apiRequest", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    process.env.EXPO_PUBLIC_SERVER_URL = "http://api.test";
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends the bearer token and returns data", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [1, 2] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(apiRequest("/api/rides", { token: "tok" })).resolves.toEqual([
      1, 2,
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/api/rides");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("surfaces the server's error code and message", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 410,
      json: async () => ({
        error: { code: "QUOTE_EXPIRED", message: "This price has expired." },
      }),
    }) as unknown as typeof fetch;

    const error = await apiRequest("/api/rides", { body: {} }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 410, code: "QUOTE_EXPIRED" });
  });

  it("turns network failures into a readable error instead of hanging", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError("Network request failed"));
    const error = await apiRequest("/api/rides").catch((e) => e);
    expect(error).toMatchObject({ code: "NETWORK" });
  });
});
