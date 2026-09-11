import { describe, expect, it, vi } from "vitest";
import { discoverHiringSource } from "../src/network-scan/discover.js";
import type { HttpClient, HttpResult } from "../src/network-scan/http/client.js";
import type { RobotsCache } from "../src/network-scan/http/robots.js";
import type { HiringSource } from "../src/network-scan/schema.js";

function html(body: string, finalUrl: string): HttpResult {
  return {
    kind: "response",
    ok: true,
    status: 200,
    finalUrl,
    contentType: "text/html",
    body,
    truncated: false,
    fromCache: false,
  };
}

function json(payload: unknown, finalUrl: string): HttpResult {
  return {
    kind: "response",
    ok: true,
    status: 200,
    finalUrl,
    contentType: "application/json",
    body: JSON.stringify(payload),
    truncated: false,
    fromCache: false,
  };
}

const notFound = (url: string): HttpResult => ({
  kind: "response",
  ok: false,
  status: 404,
  finalUrl: url,
  contentType: "text/plain",
  body: "",
  truncated: false,
  fromCache: false,
});

/** Serves a fixed URL → response map; anything else 404s. */
function stubClient(pages: Record<string, HttpResult>) {
  const requested: string[] = [];
  const client = {
    stats: { requests: 0, cacheHits: 0, failures: 0 },
    get: async (url: string) => {
      requested.push(url);
      return pages[url] ?? notFound(url);
    },
    request: async ({ url }: { url: string }) => {
      requested.push(url);
      return pages[url] ?? notFound(url);
    },
  } as unknown as HttpClient;
  return { client, requested };
}

const allowAll = { allows: async () => true } as unknown as RobotsCache;

const input = { companyId: "exampleco", companyName: "Example Co", domain: "example.com" };

describe("discoverHiringSource", () => {
  it("reuses a registry entry without making any request", async () => {
    const { client, requested } = stubClient({});
    const known: HiringSource = {
      company_id: "exampleco",
      provider: "greenhouse",
      account: "exampleco",
      confidence: 0.99,
      status: "active",
    };

    const result = await discoverHiringSource(input, {
      client,
      robots: allowAll,
      registry: new Map([["exampleco", known]]),
    });

    expect(result).toMatchObject({ provider: "greenhouse", discovery_method: "registry" });
    expect(requested).toHaveLength(0);
  });

  it("accepts a board the company's own careers page links to", async () => {
    const { client } = stubClient({
      "https://example.com/careers": html(
        '<h1>Open roles</h1><a href="https://job-boards.greenhouse.io/exampleco">Apply</a>',
        "https://example.com/careers"
      ),
      "https://boards-api.greenhouse.io/v1/boards/exampleco": json(
        { name: "Example Co" },
        "https://boards-api.greenhouse.io/v1/boards/exampleco"
      ),
    });

    const result = await discoverHiringSource(input, {
      client,
      robots: allowAll,
      registry: new Map(),
    });

    expect(result).toMatchObject({
      status: "active",
      provider: "greenhouse",
      account: "exampleco",
      verified_name: "Example Co",
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });

  // The failure this whole design guards against, one layer up from domains:
  // a linked board that turns out to belong to somebody else.
  it("records a conflict when the provider says the board is another company's", async () => {
    const { client } = stubClient({
      "https://example.com/careers": html(
        '<h1>Careers — apply now</h1><a href="https://collins.recruitee.com">Jobs</a>',
        "https://example.com/careers"
      ),
      "https://collins.recruitee.com/api/offers/": json(
        { offers: [{ title: "Shift Leader", company_name: "KFC Nederland (CFE)" }] },
        "https://collins.recruitee.com/api/offers/"
      ),
    });

    const result = await discoverHiringSource(
      { companyId: "collins-aerospace", companyName: "Collins Aerospace", domain: "example.com" },
      { client, robots: allowAll, registry: new Map() }
    );

    expect(result.status).toBe("failed");
    expect(result.verified_name).toBe("KFC Nederland (CFE)");
    expect(result.note).toMatch(/provider reports/);
  });

  it("keeps the account for a provider it recognises but cannot fetch from", async () => {
    const { client } = stubClient({
      "https://example.com/careers": html(
        '<h1>Careers</h1><p>Apply for a job</p><iframe src="https://exampleco.darwinbox.in/ms/candidate"></iframe>',
        "https://example.com/careers"
      ),
    });

    const result = await discoverHiringSource(input, {
      client,
      robots: allowAll,
      registry: new Map(),
    });

    expect(result).toMatchObject({
      status: "unsupported",
      provider: "unsupported:darwinbox",
      account: "exampleco",
    });
  });

  it("reports a careers page with no detectable provider, rather than guessing one", async () => {
    const { client } = stubClient({
      "https://example.com/careers": html(
        "<h1>Careers</h1><p>Email us to apply for a job</p>",
        "https://example.com/careers"
      ),
    });

    const result = await discoverHiringSource(input, {
      client,
      robots: allowAll,
      registry: new Map(),
    });

    expect(result.status).toBe("no_provider");
    expect(result.provider).toBe("unknown");
    expect(result.account).toBeUndefined();
  });

  it("reports no careers page when nothing careers-like is reachable", async () => {
    const { client } = stubClient({});

    const result = await discoverHiringSource(input, {
      client,
      robots: allowAll,
      registry: new Map(),
    });

    expect(result.status).toBe("no_careers_page");
  });

  it("falls back to rendering only when static discovery found no provider", async () => {
    const pages = {
      "https://example.com/careers": html(
        "<h1>Careers</h1><p>Apply for a role</p><div id='board'></div>",
        "https://example.com/careers"
      ),
      "https://boards-api.greenhouse.io/v1/boards/renderedco": json(
        { name: "Example Co" },
        "https://boards-api.greenhouse.io/v1/boards/renderedco"
      ),
    };
    const { client } = stubClient(pages);

    const probe = vi.fn(async () => ({
      html: "<div>board</div>",
      requestUrls: ["https://boards-api.greenhouse.io/v1/boards/renderedco/jobs"],
      finalUrl: "https://example.com/careers",
    }));

    const result = await discoverHiringSource(input, {
      client,
      robots: allowAll,
      registry: new Map(),
      browser: { probe, close: async () => undefined, unavailable: false } as never,
    });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "active",
      provider: "greenhouse",
      account: "renderedco",
    });
    // Rendering is weaker evidence than the employer linking the board directly.
    expect(result.confidence).toBeLessThan(0.95);
  });

  it("does not launch a browser when a provider was already found statically", async () => {
    const { client } = stubClient({
      "https://example.com/careers": html(
        '<h1>Careers, apply</h1><a href="https://jobs.lever.co/exampleco">Roles</a>',
        "https://example.com/careers"
      ),
    });
    const probe = vi.fn();

    await discoverHiringSource(input, {
      client,
      robots: allowAll,
      registry: new Map(),
      browser: { probe, close: async () => undefined, unavailable: false } as never,
    });

    expect(probe).not.toHaveBeenCalled();
  });
});

describe("verification failures never produce an active source", () => {
  // Found live: a company's careers page contained placeholder text that
  // fingerprinted as the Greenhouse board "this_part". Verification failed —
  // the board 404s — but because it reported no employer name, the old code
  // fell through and recorded it as an active source at high confidence.
  it("rejects a board token that does not resolve at the provider", async () => {
    const { client } = stubClient({
      "https://example.com/careers": html(
        '<h1>Careers</h1><p>Apply for a job. Replace boards.greenhouse.io/this_part with your board.</p>',
        "https://example.com/careers"
      ),
      // No entry for the board metadata URL, so it 404s.
    });

    const result = await discoverHiringSource(input, {
      client,
      robots: allowAll,
      registry: new Map(),
    });

    expect(result.status).not.toBe("active");
    expect(result.status).toBe("failed");
    expect(result.note).toMatch(/did not verify/);
  });

  it("still records the conflict when the provider names a different employer", async () => {
    const { client } = stubClient({
      "https://example.com/careers": html(
        '<h1>Careers, apply</h1><a href="https://boards.greenhouse.io/otherco">Jobs</a>',
        "https://example.com/careers"
      ),
      "https://boards-api.greenhouse.io/v1/boards/otherco": json(
        { name: "Some Other Company" },
        "https://boards-api.greenhouse.io/v1/boards/otherco"
      ),
    });

    const result = await discoverHiringSource(input, {
      client,
      robots: allowAll,
      registry: new Map(),
    });

    expect(result.status).toBe("failed");
    expect(result.verified_name).toBe("Some Other Company");
  });
});
