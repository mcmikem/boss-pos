// Array.prototype.flatMap is Chrome 69 / Safari 12. The build's modern bundle
// starts at Chrome 64 and its legacy bundle only polyfills what core-js detects,
// so depending on it puts a sell-screen crash on any device between those
// versions. This is the same function, written out, and it is on the hot path
// (every cart, stock and close calculation), so it stays allocation-light.
export function flatMap<T, R>(items: readonly T[] | null | undefined, project: (item: T, index: number) => readonly R[] | R[] | null | undefined): R[] {
  const out: R[] = [];
  if (!items) return out;
  for (let i = 0; i < items.length; i += 1) {
    const projected = project(items[i], i);
    if (!projected) continue;
    for (let j = 0; j < projected.length; j += 1) out.push(projected[j]);
  }
  return out;
}
