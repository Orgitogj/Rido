export function mergeById<T extends { id: string }>(
  current: T[],
  incoming: T[],
) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}
