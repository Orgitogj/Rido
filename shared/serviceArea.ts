export type Vertex = [latitude: number, longitude: number];

export const AREA_RULES = {
  minVertices: 3,
  maxVertices: 100,
  maxSpanKm: 150,
  edgeToleranceMeters: 1,
} as const;

const KM_PER_DEGREE = 111.32;

export interface BoundingBox {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

export function boundingBox(vertices: Vertex[]): BoundingBox {
  const lats = vertices.map((v) => v[0]);
  const lngs = vertices.map((v) => v[1]);
  return {
    minLatitude: Math.min(...lats),
    maxLatitude: Math.max(...lats),
    minLongitude: Math.min(...lngs),
    maxLongitude: Math.max(...lngs),
  };
}

const cross = (o: Vertex, a: Vertex, b: Vertex) =>
  (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);

function segmentsCross(p1: Vertex, p2: Vertex, p3: Vertex, p4: Vertex) {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

export function signedArea(vertices: Vertex[]) {
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const [y1, x1] = vertices[i];
    const [y2, x2] = vertices[(i + 1) % vertices.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

export type BoundaryProblem =
  | "TOO_FEW_VERTICES"
  | "TOO_MANY_VERTICES"
  | "OUT_OF_RANGE"
  | "DUPLICATE_VERTEX"
  | "SELF_INTERSECTING"
  | "ZERO_AREA"
  | "TOO_LARGE";

export function boundaryProblem(vertices: Vertex[]): BoundaryProblem | null {
  if (vertices.length < AREA_RULES.minVertices) return "TOO_FEW_VERTICES";
  if (vertices.length > AREA_RULES.maxVertices) return "TOO_MANY_VERTICES";
  for (const [lat, lng] of vertices) {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -85 ||
      lat > 85 ||
      lng < -180 ||
      lng > 180
    ) {
      return "OUT_OF_RANGE";
    }
  }
  const keys = new Set(vertices.map(([a, b]) => `${a},${b}`));
  if (keys.size !== vertices.length) return "DUPLICATE_VERTEX";
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (
        segmentsCross(
          vertices[i],
          vertices[(i + 1) % n],
          vertices[j],
          vertices[(j + 1) % n],
        )
      ) {
        return "SELF_INTERSECTING";
      }
    }
  }
  if (Math.abs(signedArea(vertices)) < 1e-10) return "ZERO_AREA";
  const box = boundingBox(vertices);
  const midLat = ((box.minLatitude + box.maxLatitude) / 2) * (Math.PI / 180);
  const heightKm = (box.maxLatitude - box.minLatitude) * KM_PER_DEGREE;
  const widthKm =
    (box.maxLongitude - box.minLongitude) * KM_PER_DEGREE * Math.cos(midLat);
  if (
    heightKm > AREA_RULES.maxSpanKm ||
    widthKm > AREA_RULES.maxSpanKm ||
    box.maxLongitude - box.minLongitude > 180
  ) {
    return "TOO_LARGE";
  }
  return null;
}

export const BOUNDARY_PROBLEM_TEXT: Record<BoundaryProblem, string> = {
  TOO_FEW_VERTICES: `A boundary needs at least ${AREA_RULES.minVertices} points.`,
  TOO_MANY_VERTICES: `A boundary can have at most ${AREA_RULES.maxVertices} points.`,
  OUT_OF_RANGE: "Every point needs a valid latitude and longitude.",
  DUPLICATE_VERTEX: "The same point appears twice.",
  SELF_INTERSECTING:
    "The boundary crosses itself. List the points in order around the edge.",
  ZERO_AREA: "The points don't enclose an area.",
  TOO_LARGE: `An area can span at most ${AREA_RULES.maxSpanKm} km in each direction.`,
};

function metersFromSegment(
  p: { latitude: number; longitude: number },
  a: Vertex,
  b: Vertex,
) {
  const scale = Math.cos((p.latitude * Math.PI) / 180);
  const px = p.longitude * scale;
  const py = p.latitude;
  const ax = a[1] * scale;
  const ay = a[0];
  const bx = b[1] * scale;
  const by = b[0];
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len))
    : 0;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy) * KM_PER_DEGREE * 1000;
}

export function containsPoint(
  vertices: Vertex[],
  p: { latitude: number; longitude: number },
): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [yi, xi] = vertices[i];
    const [yj, xj] = vertices[j];
    if (
      metersFromSegment(p, vertices[j], vertices[i]) <=
      AREA_RULES.edgeToleranceMeters
    ) {
      return true;
    }
    if (
      yi > p.latitude !== yj > p.latitude &&
      p.longitude < ((xj - xi) * (p.latitude - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function parseBoundary(text: string): Vertex[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const vertices: Vertex[] = [];
  for (const line of lines) {
    const match = /^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/.exec(line);
    if (!match) return null;
    vertices.push([Number(match[1]), Number(match[2])]);
  }
  if (
    vertices.length > 1 &&
    vertices[0][0] === vertices[vertices.length - 1][0] &&
    vertices[0][1] === vertices[vertices.length - 1][1]
  ) {
    vertices.pop();
  }
  return vertices;
}

export function formatBoundary(vertices: Vertex[]) {
  return vertices.map(([lat, lng]) => `${lat}, ${lng}`).join("\n");
}
