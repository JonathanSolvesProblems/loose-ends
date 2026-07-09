// Bounded concurrency.
//
// Running Promise.all over every open loop, or every RTS hit, fires one model
// request per item simultaneously. With fifty open loops in a busy channel that
// is fifty concurrent OpenAI calls from a single Slack message: a fast route to a
// 429, and (now that failures log loudly) to a wall of error output.
//
// Serial was too slow, unbounded parallel is reckless, so: a small worker pool.

/** Run `fn` over `items` with at most `limit` in flight. Order is preserved. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
