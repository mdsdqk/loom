import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/**
 * The one HTTP path every network-scan stage uses.
 *
 * Scanning hundreds of employer sites politely is the whole job here: bounded
 * concurrency, one request at a time per host with a floor on the gap between
 * them, capped response sizes, bounded retries, and an on-disk cache so a
 * re-run costs nothing. Nothing in this file works around rate limits, bot
 * protection, or access controls — a blocked response is recorded as a failure
 * and the scan moves on.
 */

export const USER_AGENT =
  "loom-network-scan/0.1 (+https://github.com/loom; public job listings; contact via repo)";

export interface HttpOptions {
  /** Milliseconds before a single attempt is abandoned. */
  timeoutMs: number;
  /** Total attempts per request, including the first. */
  maxAttempts: number;
  /** Bytes read from a response body before it is truncated. */
  maxBytes: number;
  /** Requests in flight across all hosts. */
  concurrency: number;
  /** Minimum gap between two requests to the same host. */
  perHostDelayMs: number;
  /** How long a cached response stays fresh. */
  cacheTtlMs: number;
  /** Directory for the response cache, or null to disable caching. */
  cacheDir: string | null;
}

export const DEFAULT_HTTP_OPTIONS: HttpOptions = {
  timeoutMs: 15_000,
  maxAttempts: 3,
  maxBytes: 2_000_000,
  concurrency: 8,
  perHostDelayMs: 1_000,
  cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
  cacheDir: "../.cache/network-scan/http",
};

export interface HttpRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** Skip the cache for this request, both reading and writing. */
  noCache?: boolean;
  /** Override the body size cap. Job payloads dwarf careers pages. */
  maxBytes?: number;
}

export interface HttpResponse {
  kind: "response";
  ok: boolean;
  status: number;
  /** URL after redirects — the identity of what was actually fetched. */
  finalUrl: string;
  contentType: string;
  body: string;
  /** Body hit `maxBytes` and was cut short. */
  truncated: boolean;
  fromCache: boolean;
}

export interface HttpFailure {
  kind: "failure";
  /** Machine-readable reason, for attributing scan-funnel drops. */
  reason: "dns" | "tls" | "timeout" | "network" | "too_many_redirects" | "aborted";
  message: string;
  finalUrl: string;
}

export type HttpResult = HttpResponse | HttpFailure;

/** A reply was received. Says nothing about the status code — check `status`. */
export function isSuccess(result: HttpResult): result is HttpResponse {
  return result.kind === "response";
}

/** Status codes worth another attempt: transient server and throttling responses. */
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

function classifyError(error: unknown): HttpFailure["reason"] {
  const message = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) return "dns";
  if (/certificate|TLS|SSL|self-signed|ERR_TLS/i.test(message)) return "tls";
  if (/timeout|timed out|aborted|AbortError/i.test(message)) return "timeout";
  if (/redirect/i.test(message)) return "too_many_redirects";
  return "network";
}

function cachePath(cacheDir: string, request: HttpRequest): string {
  const key = createHash("sha256")
    .update(`${request.method ?? "GET"} ${request.url} ${request.body ?? ""}`)
    .digest("hex");
  return join(cacheDir, key.slice(0, 2), `${key}.json`);
}

interface CacheEntry {
  fetchedAt: number;
  response: HttpResponse;
}

/**
 * Serializes work per host and caps total concurrency, so a scan spreads across
 * many domains instead of hammering any one of them.
 */
class HostScheduler {
  private readonly hostChains = new Map<string, Promise<void>>();
  /** Per-host delay overrides, e.g. a Crawl-delay published in robots.txt. */
  private readonly hostDelays = new Map<string, number>();
  /** Requests queued or running per host, so settled hosts can be forgotten. */
  private readonly hostDepth = new Map<string, number>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly concurrency: number, private readonly perHostDelayMs: number) {}

  private async acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    this.waiting.shift()?.();
  }

  setHostDelay(host: string, delayMs: number): void {
    const current = this.hostDelays.get(host) ?? 0;
    if (delayMs > current) this.hostDelays.set(host, delayMs);
  }

  private delayFor(host: string): number {
    return Math.max(this.perHostDelayMs, this.hostDelays.get(host) ?? 0);
  }

  run<T>(host: string, task: () => Promise<T>): Promise<T> {
    const previous = this.hostChains.get(host) ?? Promise.resolve();
    this.hostDepth.set(host, (this.hostDepth.get(host) ?? 0) + 1);

    const result = previous.then(async () => {
      await this.acquire();
      try {
        return await task();
      } finally {
        this.release();
      }
    });

    // The chain paces the *next* request to this host and must never reject.
    const pause = this.delayFor(host);
    const paced = result.then(
      () => delay(pause),
      () => delay(pause)
    );

    // A scan touches thousands of hosts, nearly all of them once or twice.
    // Holding a promise chain per host for the whole run accumulates without
    // bound, so drop a host's chain as soon as nothing is queued behind it.
    this.hostChains.set(
      host,
      paced.then(() => {
        const depth = (this.hostDepth.get(host) ?? 1) - 1;
        if (depth <= 0) {
          this.hostDepth.delete(host);
          this.hostChains.delete(host);
        } else {
          this.hostDepth.set(host, depth);
        }
      })
    );

    return result;
  }
}

export class HttpClient {
  private readonly options: HttpOptions;
  private readonly scheduler: HostScheduler;
  readonly stats = { requests: 0, cacheHits: 0, failures: 0 };

  constructor(options: Partial<HttpOptions> = {}) {
    this.options = { ...DEFAULT_HTTP_OPTIONS, ...options };
    this.scheduler = new HostScheduler(this.options.concurrency, this.options.perHostDelayMs);
  }

  private async readCache(request: HttpRequest): Promise<HttpResponse | null> {
    if (!this.options.cacheDir || request.noCache) return null;
    try {
      const raw = await readFile(cachePath(this.options.cacheDir, request), "utf8");
      const entry = JSON.parse(raw) as CacheEntry;
      if (Date.now() - entry.fetchedAt > this.options.cacheTtlMs) return null;
      return { ...entry.response, fromCache: true };
    } catch {
      return null;
    }
  }

  private async writeCache(request: HttpRequest, response: HttpResponse): Promise<void> {
    if (!this.options.cacheDir || request.noCache) return;
    const path = cachePath(this.options.cacheDir, request);
    const entry: CacheEntry = {
      fetchedAt: Date.now(),
      response: { ...response, fromCache: false },
    };
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(entry), "utf8");
    } catch {
      // A cache that cannot be written is not a scan failure.
    }
  }

  /** Reads at most `maxBytes` of the body, then abandons the rest. */
  private async readBody(
    response: Response,
    maxBytes: number
  ): Promise<{ body: string; truncated: boolean }> {
    if (!response.body) return { body: "", truncated: false };

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
          truncated = true;
          break;
        }
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }

    return { body: Buffer.concat(chunks).toString("utf8"), truncated };
  }

  private async attempt(request: HttpRequest): Promise<HttpResult> {
    try {
      const response = await fetch(request.url, {
        method: request.method ?? "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "*/*",
          "Accept-Language": "en",
          ...request.headers,
        },
        body: request.body,
        redirect: "follow",
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });

      const { body, truncated } = await this.readBody(
        response,
        request.maxBytes ?? this.options.maxBytes
      );

      return {
        kind: "response",
        ok: response.ok,
        status: response.status,
        finalUrl: response.url || request.url,
        contentType: response.headers.get("content-type") ?? "",
        body,
        truncated,
        fromCache: false,
      };
    } catch (error) {
      return {
        kind: "failure",
        reason: classifyError(error),
        message: error instanceof Error ? error.message : String(error),
        finalUrl: request.url,
      };
    }
  }

  async request(request: HttpRequest): Promise<HttpResult> {
    const cached = await this.readCache(request);
    if (cached) {
      this.stats.cacheHits += 1;
      return cached;
    }

    let host: string;
    try {
      host = new URL(request.url).host;
    } catch {
      return {
        kind: "failure",
        reason: "network",
        message: `Invalid URL: ${request.url}`,
        finalUrl: request.url,
      };
    }

    return this.scheduler.run(host, async () => {
      let last: HttpResult = {
        kind: "failure",
        reason: "network",
        message: "no attempt made",
        finalUrl: request.url,
      };

      for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
        this.stats.requests += 1;
        last = await this.attempt(request);

        const retryable =
          last.kind === "failure"
            ? last.reason !== "dns" && last.reason !== "tls"
            : RETRYABLE.has(last.status);
        if (!retryable) break;

        if (attempt < this.options.maxAttempts) {
          await delay(500 * 2 ** (attempt - 1));
        }
      }

      if (last.kind === "failure") {
        this.stats.failures += 1;
      } else if (last.status >= 200 && last.status < 300 && !last.truncated) {
        // Only durable successes are worth keeping. Caching a 404, a 503 after
        // retries, or a body cut off at `maxBytes` replays a transient problem
        // for the whole TTL — and a truncated JSON body fails to parse on every
        // later run, turning one bad fetch into a permanent one.
        await this.writeCache(request, last);
      }

      return last;
    });
  }

  get(url: string, headers?: Record<string, string>): Promise<HttpResult> {
    return this.request({ url, method: "GET", headers });
  }

  /** Raises the pause between requests to one host, e.g. to honour Crawl-delay. */
  setHostDelay(host: string, delayMs: number): void {
    if (Number.isFinite(delayMs) && delayMs > 0) this.scheduler.setHostDelay(host, delayMs);
  }
}
