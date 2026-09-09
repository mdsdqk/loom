import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpClient, isSuccess } from "../src/network-scan/http/client.js";

/** Builds a `fetch` stand-in from a per-URL handler, tracking call order. */
function stubFetch(handler: (url: string, calls: number) => Partial<Response> | Error) {
  const perUrl = new Map<string, number>();
  const log: string[] = [];

  const impl = vi.fn(async (input: string | URL) => {
    const url = String(input);
    const calls = (perUrl.get(url) ?? 0) + 1;
    perUrl.set(url, calls);
    log.push(url);

    const outcome = handler(url, calls);
    if (outcome instanceof Error) throw outcome;

    const body = (outcome.body as unknown as string) ?? "";
    return {
      ok: (outcome.status ?? 200) < 400,
      status: outcome.status ?? 200,
      url: outcome.url ?? url,
      headers: new Headers({ "content-type": "text/html", ...(outcome.headers as object) }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      }),
    } as unknown as Response;
  });

  vi.stubGlobal("fetch", impl);
  return { log, impl };
}

const noCache = { cacheDir: null, perHostDelayMs: 0 } as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpClient", () => {
  it("returns the body and the post-redirect final URL", async () => {
    stubFetch(() => ({ body: "<html>hi</html>", url: "https://example.com/final" }));

    const client = new HttpClient(noCache);
    const result = await client.get("https://example.com/start");

    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.body).toBe("<html>hi</html>");
    expect(result.finalUrl).toBe("https://example.com/final");
  });

  it("retries a retryable status and stops once it succeeds", async () => {
    stubFetch((_url, calls) => (calls < 3 ? { status: 503 } : { status: 200, body: "ok" }));

    const client = new HttpClient({ ...noCache, maxAttempts: 4 });
    const result = await client.get("https://example.com/");

    expect(isSuccess(result) && result.status).toBe(200);
  });

  it("gives up after maxAttempts and reports the last status", async () => {
    const { impl } = stubFetch(() => ({ status: 503 }));

    const client = new HttpClient({ ...noCache, maxAttempts: 2 });
    const result = await client.get("https://example.com/");

    expect(impl).toHaveBeenCalledTimes(2);
    expect(isSuccess(result) && result.status).toBe(503);
  });

  it("does not retry a DNS failure — the host simply does not exist", async () => {
    const { impl } = stubFetch(() => new Error("getaddrinfo ENOTFOUND nope.example"));

    const client = new HttpClient({ ...noCache, maxAttempts: 3 });
    const result = await client.get("https://nope.example/");

    expect(impl).toHaveBeenCalledTimes(1);
    expect(isSuccess(result)).toBe(false);
    if (isSuccess(result)) return;
    expect(result.reason).toBe("dns");
  });

  it("does not retry a 404", async () => {
    const { impl } = stubFetch(() => ({ status: 404 }));

    await new HttpClient({ ...noCache, maxAttempts: 3 }).get("https://example.com/");

    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("truncates a body larger than maxBytes instead of buffering it all", async () => {
    stubFetch(() => ({ body: "x".repeat(50_000) }));

    const client = new HttpClient({ ...noCache, maxBytes: 1000 });
    const result = await client.get("https://example.com/");

    expect(isSuccess(result)).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.body.length).toBe(1000);
    expect(result.truncated).toBe(true);
  });

  it("serializes requests to the same host", async () => {
    let concurrent = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await new Promise((r) => setTimeout(r, 5));
        concurrent -= 1;
        return {
          ok: true,
          status: 200,
          url: "https://same.example/",
          headers: new Headers(),
          body: null,
        } as unknown as Response;
      })
    );

    const client = new HttpClient({ ...noCache, concurrency: 8 });
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => client.get(`https://same.example/${i}`))
    );

    expect(peak).toBe(1);
  });

  it("caps total in-flight requests across different hosts", async () => {
    let concurrent = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await new Promise((r) => setTimeout(r, 5));
        concurrent -= 1;
        return {
          ok: true,
          status: 200,
          url: "https://x/",
          headers: new Headers(),
          body: null,
        } as unknown as Response;
      })
    );

    const client = new HttpClient({ ...noCache, concurrency: 3 });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => client.get(`https://host${i}.example/`))
    );

    expect(peak).toBeLessThanOrEqual(3);
  });

  it("rejects an unparseable URL without attempting a request", async () => {
    const { impl } = stubFetch(() => ({ status: 200 }));

    const result = await new HttpClient(noCache).get("not a url");

    expect(impl).not.toHaveBeenCalled();
    expect(isSuccess(result)).toBe(false);
  });

  it("counts requests, failures and cache hits", async () => {
    stubFetch((url) =>
      url.includes("bad") ? new Error("getaddrinfo ENOTFOUND bad") : { status: 200, body: "ok" }
    );

    const client = new HttpClient(noCache);
    await client.get("https://good.example/");
    await client.get("https://bad.example/");

    expect(client.stats.requests).toBe(2);
    expect(client.stats.failures).toBe(1);
  });
});

// A live-socket check over many origins. The earlier version of this test
// asserted only handle counts and passed while every request was failing, so it
// now asserts the responses too — a handle guard that does not confirm traffic
// actually happened guards nothing.
describe("HttpClient over many origins", () => {
  it(
    "completes every request and leaves no socket handles behind",
    { timeout: 30_000 },
    async () => {
      const { createServer } = await import("node:http");
      const { setTimeout: sleep } = await import("node:timers/promises");

      const ports = await Promise.all(
        Array.from({ length: 40 }, () =>
          new Promise<number>((resolve) => {
            const server = createServer((_req, res) => {
              res.writeHead(200, { "content-type": "text/html", connection: "close" });
              res.end("<html><head><title>T</title></head></html>");
            });
            server.listen(0, "127.0.0.1", () =>
              resolve((server.address() as { port: number }).port)
            );
            server.unref();
          })
        )
      );

      const client = new HttpClient({ cacheDir: null, perHostDelayMs: 0, concurrency: 8 });
      const results = await Promise.all(
        ports.map((port) => client.get(`http://127.0.0.1:${port}/`))
      );

      expect(results.every((r) => isSuccess(r) && r.status === 200)).toBe(true);
      expect(results.every((r) => isSuccess(r) && r.body.includes("<title>"))).toBe(true);

      await sleep(2000);
      const sockets = process
        .getActiveResourcesInfo()
        .filter((handle) => handle === "TCPSocketWrap").length;
      expect(sockets).toBeLessThan(10);
    }
  );
});

// Caching a transient or partial response replays one bad fetch for the whole
// TTL, and a truncated JSON body fails to parse on every later run.
describe("HttpClient caching policy", () => {
  it("caches only complete successful responses", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    for (const [label, reply, shouldCache] of [
      ["200", { status: 200, body: "ok" }, true],
      ["404", { status: 404, body: "" }, false],
      ["503", { status: 503, body: "" }, false],
    ] as [string, { status: number; body: string }, boolean][]) {
      const cacheDir = await mkdtemp(join(tmpdir(), "loom-cache-"));
      const { impl } = stubFetch(() => reply);
      const client = new HttpClient({ cacheDir, perHostDelayMs: 0, maxAttempts: 1 });

      await client.get(`https://example.com/${label}`);
      await client.get(`https://example.com/${label}`);

      // A cached response means the second call never reaches fetch.
      expect(impl.mock.calls.length, label).toBe(shouldCache ? 1 : 2);
      vi.unstubAllGlobals();
    }
  });

  it("does not cache a truncated body", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const cacheDir = await mkdtemp(join(tmpdir(), "loom-cache-"));
    const { impl } = stubFetch(() => ({ status: 200, body: "x".repeat(5000) }));
    const client = new HttpClient({ cacheDir, perHostDelayMs: 0, maxBytes: 100 });

    const first = await client.get("https://example.com/big");
    await client.get("https://example.com/big");

    expect(isSuccess(first) && first.truncated).toBe(true);
    expect(impl).toHaveBeenCalledTimes(2);
  });
});
