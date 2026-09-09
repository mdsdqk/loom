/**
 * Runs an async mapper over a list with a fixed number of workers.
 *
 * Bounding the *unit of work* matters as much as bounding HTTP. Launching one
 * promise chain per company and relying on the HTTP client's limit still lets
 * everything else — DNS lookups, buffered response bodies, pending timers —
 * fan out across the whole list at once, which is enough to bring the process
 * down on a large network.
 *
 * Results come back in input order regardless of completion order.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onSettled?: (result: R, index: number) => void
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const width = Math.max(1, Math.min(limit, items.length));
  let next = 0;

  async function run(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      const result = await worker(items[index], index);
      results[index] = result;
      onSettled?.(result, index);
    }
  }

  await Promise.all(Array.from({ length: width }, run));
  return results;
}
