export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: { path: string; code: string }[],
  ) {
    super(message);
  }
}

export const unavailable = () =>
  new ApiError(
    503,
    "SERVICE_UNAVAILABLE",
    "This service is temporarily unavailable. Please try again later.",
  );

export const notFound = (what = "Record") =>
  new ApiError(404, "NOT_FOUND", `${what} not found.`);

export const unauthenticated = (message = "Please sign in to continue.") =>
  new ApiError(401, "UNAUTHENTICATED", message);

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(JSON.stringify({ event: "missing_config", name }));
    throw unavailable();
  }
  return value;
}
