export function dollarsToCents(text: string): number | null {
  const trimmed = text.trim().replace(/^\$/, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function dayRange(from: string, to: string) {
  const valid = (d: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
  const out: Record<string, string> = {};
  if (from && valid(from)) out.from = `${from}T00:00:00.000Z`;
  if (to && valid(to)) {
    const end = new Date(`${to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    out.to = end.toISOString();
  }
  return out;
}

export function buildQuery(
  params: Record<string, string | number | undefined | null>,
) {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  ) as [string, string | number][];
  const qs = new URLSearchParams(
    entries.map(([k, v]) => [k, String(v)]),
  ).toString();
  return qs ? `?${qs}` : "";
}
