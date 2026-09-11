import { describe, expect, it } from "vitest";
import {
  candidateDomains,
  distinguishingTokens,
  extractIdentitySignals,
  registrableDomain,
  resolveCompanyDomain,
  summarizeAttempts,
  verifyIdentity,
} from "../src/network-scan/domains.js";
import { mapWithConcurrency } from "../src/network-scan/concurrency.js";
import { isAllowed, matchesPattern, parseRobots } from "../src/network-scan/http/robots.js";
import type { HttpClient, HttpResult } from "../src/network-scan/http/client.js";
import type { RobotsCache } from "../src/network-scan/http/robots.js";

/** A 200 that stays on the URL it was requested from — the ordinary case. */
function page(finalUrl: string, head: string, body = ""): HttpResult {
  return {
    kind: "response",
    ok: true,
    status: 200,
    finalUrl,
    contentType: "text/html",
    body: `<html><head>${head}</head><body>${body}</body></html>`,
    truncated: false,
    fromCache: false,
  };
}

/** A client that answers from a fixed URL → response map; anything else 404s. */
function stubClient(pages: Record<string, HttpResult>): HttpClient {
  return {
    stats: { requests: 0, cacheHits: 0, failures: 0 },
    get: async (url: string) =>
      pages[url] ?? {
        kind: "response" as const,
        ok: false,
        status: 404,
        finalUrl: url,
        contentType: "text/html",
        body: "",
        truncated: false,
        fromCache: false,
      },
  } as unknown as HttpClient;
}

const allowAll = { allows: async () => true } as unknown as RobotsCache;

describe("distinguishingTokens", () => {
  it("drops words that do not identify a company", () => {
    expect(distinguishingTokens("Persistent Systems")).toEqual(["persistent"]);
    expect(distinguishingTokens("Cloud Collab Technologies Private Limited")).toEqual([
      "cloud",
      "collab",
    ]);
  });

  it("keeps generic words when they are all the name has", () => {
    expect(distinguishingTokens("Tech Solutions")).toEqual(["tech", "solutions"]);
  });
});

describe("candidateDomains", () => {
  it("is bounded and ordered, preferring .com", () => {
    const candidates = candidateDomains("Collins Aerospace");

    expect(candidates[0]).toBe("collinsaerospace.com");
    expect(candidates).toContain("collins-aerospace.com");
    expect(candidates).toContain("collins.com");
    expect(candidates.length).toBeLessThanOrEqual(8);
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("returns nothing for a name with no usable tokens", () => {
    expect(candidateDomains("!!!")).toEqual([]);
  });
});

describe("extractIdentitySignals", () => {
  it("reads the fields a site uses to name itself", () => {
    const signals = extractIdentitySignals(
      `<title>Razorpay | Payment Gateway</title>
       <meta property="og:site_name" content="Razorpay" />
       <meta name="description" content="Online payments for India" />`
    );

    expect(signals.title).toBe("Razorpay | Payment Gateway");
    expect(signals.siteName).toBe("Razorpay");
    expect(signals.description).toBe("Online payments for India");
  });
});

describe("verifyIdentity", () => {
  it("accepts a page that names the company", () => {
    const result = verifyIdentity("Razorpay", extractIdentitySignals("<title>Razorpay</title>"));

    expect(result.verified).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("rejects a page belonging to a different company", () => {
    const result = verifyIdentity(
      "Collins Aerospace",
      extractIdentitySignals("<title>Collins Dictionary</title>")
    );

    expect(result.verified).toBe(false);
  });

  it("requires every distinguishing token, not just the first", () => {
    const partial = verifyIdentity(
      "Northwind Robotics",
      extractIdentitySignals("<title>Northwind Traders</title>")
    );
    expect(partial.verified).toBe(false);

    const full = verifyIdentity(
      "Northwind Robotics",
      extractIdentitySignals("<title>Northwind Robotics</title>")
    );
    expect(full.verified).toBe(true);
  });

  it("matches a name written without spaces", () => {
    const result = verifyIdentity(
      "M2P Fintech",
      extractIdentitySignals("<title>M2PFintech</title>")
    );

    expect(result.verified).toBe(true);
  });

  it("rejects a parked or for-sale domain", () => {
    const result = verifyIdentity(
      "Weave",
      extractIdentitySignals("<title>Weave</title>"),
      "This domain is for sale. Buy this domain today."
    );

    expect(result.verified).toBe(false);
    expect(result.matchedOn).toBe("parked");
  });

  it("caps confidence and flags names too short to identify reliably", () => {
    const result = verifyIdentity("EY", extractIdentitySignals("<title>EY - Home</title>"));

    expect(result.weakName).toBe(true);
    expect(result.confidence).toBeLessThanOrEqual(0.7);
  });

  it("scores a contiguous phrase above scattered tokens", () => {
    const contiguous = verifyIdentity(
      "Cloud Collab",
      extractIdentitySignals("<title>Cloud Collab</title>")
    );
    const scattered = verifyIdentity(
      "Cloud Collab",
      extractIdentitySignals("<title>Collab tools for the cloud</title>")
    );

    expect(contiguous.confidence).toBeGreaterThan(scattered.confidence);
    expect(scattered.verified).toBe(true);
  });
});

describe("resolveCompanyDomain", () => {
  const company = { id: "razorpay", canonical_name: "Razorpay" };

  it("uses the registry without making a request", async () => {
    const client = stubClient({});
    const result = await resolveCompanyDomain(company, {
      client,
      robots: allowAll,
      registry: new Map([["razorpay", "razorpay.com"]]),
      hostExists: async () => {
        throw new Error("should not probe DNS when the registry answers");
      },
    });

    expect(result).toMatchObject({
      status: "verified",
      method: "registry",
      domain: "razorpay.com",
    });
  });

  it("accepts a guessed domain only once the site confirms the name", async () => {
    const client = stubClient({
      "https://razorpay.com/": page("https://razorpay.com/", "<title>Razorpay</title>"),
    });

    const result = await resolveCompanyDomain(company, {
      client,
      robots: allowAll,
      registry: new Map(),
      hostExists: async () => true,
    });

    expect(result).toMatchObject({ status: "verified", method: "guess_verified" });
    expect(result.domain).toBe("razorpay.com");
  });

  it("leaves a company unresolved when a guessed domain names someone else", async () => {
    const client = stubClient({
      "https://collins.com/": page("https://collins.com/", "<title>Collins Dictionary</title>"),
    });

    const result = await resolveCompanyDomain(
      { id: "collins-aerospace", canonical_name: "Collins Aerospace" },
      { client, robots: allowAll, registry: new Map(), hostExists: async () => true }
    );

    expect(result.status).toBe("unresolved");
    expect(result.domain).toBeUndefined();
    expect(result.attempts.some((a) => a.outcome === "name_mismatch")).toBe(true);
  });

  // Found live: caterpillar.io redirected to BrandBucket, whose listing page
  // puts the domain in its own <title> and so passed a pure name check.
  it("rejects a candidate that redirects to a domain marketplace", async () => {
    const client = stubClient({
      "https://caterpillar.com/": {
        kind: "response",
        ok: true,
        status: 200,
        finalUrl: "https://www.brandbucket.com/names/caterpillar",
        contentType: "text/html",
        body: "<html><head><title>Caterpillar - premium domain for sale</title></head></html>",
        truncated: false,
        fromCache: false,
      },
    });

    const result = await resolveCompanyDomain(
      { id: "caterpillar", canonical_name: "Caterpillar Inc." },
      { client, robots: allowAll, registry: new Map(), hostExists: async () => true }
    );

    expect(result.status).toBe("unresolved");
    expect(result.attempts[0].outcome).toBe("parked");
  });

  it("rejects an offsite redirect whose destination does not carry the company name", async () => {
    const client = stubClient({
      "https://northwindtraders.com/": {
        kind: "response",
        ok: true,
        status: 200,
        finalUrl: "https://unrelated-parking-host.net/listing",
        contentType: "text/html",
        body: "<html><head><title>Northwind Traders</title></head></html>",
        truncated: false,
        fromCache: false,
      },
    });

    const result = await resolveCompanyDomain(
      { id: "northwind-traders", canonical_name: "Northwind Traders" },
      { client, robots: allowAll, registry: new Map(), hostExists: async () => true }
    );

    expect(result.status).toBe("unresolved");
    expect(result.attempts[0].outcome).toBe("offsite_redirect");
  });

  it("allows an offsite redirect to a domain that does carry the company name", async () => {
    const client = stubClient({
      "https://amazonwebservices.com/": {
        kind: "response",
        ok: true,
        status: 200,
        finalUrl: "https://aws.amazon.com/",
        contentType: "text/html",
        body: '<html><head><meta property="og:site_name" content="Amazon Web Services, Inc." /></head></html>',
        truncated: false,
        fromCache: false,
      },
    });

    const result = await resolveCompanyDomain(
      { id: "amazon-web-services", canonical_name: "Amazon Web Services (AWS)" },
      { client, robots: allowAll, registry: new Map(), hostExists: async () => true }
    );

    expect(result.status).toBe("verified");
    expect(result.domain).toBe("aws.amazon.com");
  });

  it("skips candidates that do not resolve in DNS", async () => {
    const result = await resolveCompanyDomain(company, {
      client: stubClient({}),
      robots: allowAll,
      registry: new Map(),
      hostExists: async () => false,
    });

    expect(result.status).toBe("unresolved");
    expect(result.attempts.every((a) => a.outcome === "no_dns")).toBe(true);
  });

  it("honours a robots.txt disallow", async () => {
    const result = await resolveCompanyDomain(company, {
      client: stubClient({
        "https://razorpay.com/": page("https://razorpay.com/", "<title>Razorpay</title>"),
      }),
      robots: { allows: async () => false } as unknown as RobotsCache,
      registry: new Map(),
      hostExists: async () => true,
    });

    expect(result.status).toBe("unresolved");
    expect(result.attempts[0].outcome).toBe("robots_disallowed");
  });
});

describe("robots.txt", () => {
  it("applies the wildcard group when no agent matches", () => {
    const policy = parseRobots("User-agent: *\nDisallow: /admin\nAllow: /admin/public\n");

    expect(isAllowed(policy, "/careers")).toBe(true);
    expect(isAllowed(policy, "/admin/secret")).toBe(false);
    expect(isAllowed(policy, "/admin/public/page")).toBe(true);
  });

  it("prefers a group naming our agent over the wildcard", () => {
    const policy = parseRobots(
      "User-agent: *\nDisallow: /\n\nUser-agent: loom-network-scan\nDisallow: /private\n"
    );

    expect(isAllowed(policy, "/careers")).toBe(true);
    expect(isAllowed(policy, "/private/x")).toBe(false);
  });

  it("treats an empty Disallow as permission and allows unknown paths", () => {
    expect(isAllowed(parseRobots("User-agent: *\nDisallow:\n"), "/anything")).toBe(true);
    expect(isAllowed(parseRobots(""), "/anything")).toBe(true);
  });

  it("honours wildcard and end-anchored patterns", () => {
    const policy = parseRobots("User-agent: *\nDisallow: /*.pdf$\n");

    expect(isAllowed(policy, "/files/report.pdf")).toBe(false);
    expect(isAllowed(policy, "/files/report.pdf.html")).toBe(true);
  });
});

describe("registrableDomain", () => {
  it.each([
    ["www.example.com", "example.com"],
    ["careers.example.com", "example.com"],
    ["a.b.example.co.uk", "example.co.uk"],
    ["jobs.example.co.in", "example.co.in"],
    ["example.io", "example.io"],
  ])("reduces %j to %j", (host, expected) => {
    expect(registrableDomain(host)).toBe(expected);
  });
});

describe("mapWithConcurrency", () => {
  it("never exceeds the worker limit", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 50 }, (_, i) => i);

    await mapWithConcurrency(items, 5, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active -= 1;
      return n;
    });

    expect(peak).toBeLessThanOrEqual(5);
  });

  it("returns results in input order, not completion order", async () => {
    const results = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });

    expect(results).toEqual([30, 10, 20]);
  });

  it("handles an empty list and a limit above the list length", async () => {
    expect(await mapWithConcurrency([], 4, async (n) => n)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 99, async (n) => n * 2)).toEqual([2, 4]);
  });
});

describe("matchesPattern", () => {
  it.each([
    ["/admin", "/admin/secret", true],
    ["/admin", "/public", false],
    ["/*.pdf$", "/files/a.pdf", true],
    ["/*.pdf$", "/files/a.pdf.html", false],
    ["/a/*/b", "/a/x/y/b", true],
    ["/a/*/b", "/a/x/y/c", false],
    ["/exact$", "/exact", true],
    ["/exact$", "/exact/more", false],
  ])("pattern %j vs path %j is %s", (pattern, path, expected) => {
    expect(matchesPattern(pattern, path)).toBe(expected);
  });

  // A regex-based matcher compiling `*` to `.*` backtracks exponentially here
  // and overflows V8's regex stack, taking the whole process down.
  it("stays linear on a pathological multi-wildcard pattern", () => {
    const pattern = `/${"*a".repeat(40)}$`;
    const path = `/${"a".repeat(4000)}b`;
    const started = Date.now();

    expect(matchesPattern(pattern, path)).toBe(false);
    expect(Date.now() - started).toBeLessThan(250);
  });
});

describe("extractIdentitySignals resilience", () => {
  it("stays fast on a large page with many meta tags and no closing head", () => {
    const html = `<title>Contoso</title>${'<meta name="x" content="y">'.repeat(5000)}${"z".repeat(200_000)}`;
    const started = Date.now();
    const signals = extractIdentitySignals(html);

    expect(signals.title).toBe("Contoso");
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("reads meta tags regardless of attribute order", () => {
    const signals = extractIdentitySignals(
      `<head><meta content="Contoso Ltd" property="og:site_name"><title>Home</title></head>`
    );

    expect(signals.siteName).toBe("Contoso Ltd");
  });
});

describe("verifyIdentity partial-name scoring", () => {
  // Found live: "Tata Consultancy Services" matched tata.com, the parent
  // group's site, because generic-token stripping left only "tata".
  it("scores a parent-company match well below a full-name match", () => {
    const parent = verifyIdentity(
      "Tata Consultancy Services",
      extractIdentitySignals("<title>Tata Group</title>")
    );
    const real = verifyIdentity(
      "Tata Consultancy Services",
      extractIdentitySignals("<title>Tata Consultancy Services</title>")
    );

    expect(parent.verified).toBe(true);
    expect(parent.partialName).toBe(true);
    expect(parent.confidence).toBeLessThan(0.8);
    expect(real.partialName).toBe(false);
    expect(real.confidence).toBeGreaterThan(parent.confidence);
  });

  it("does not flag a partial match when the name has no generic words", () => {
    const result = verifyIdentity("Razorpay", extractIdentitySignals("<title>Razorpay</title>"));

    expect(result.partialName).toBe(false);
    expect(result.confidence).toBe(0.95);
  });

  it("scores all-tokens-present below a contiguous phrase", () => {
    const scattered = verifyIdentity(
      "Bread Financial",
      extractIdentitySignals("<title>Financial products, freshly bread</title>")
    );
    const contiguous = verifyIdentity(
      "Bread Financial",
      extractIdentitySignals("<title>Bread Financial</title>")
    );

    expect(scattered.confidence).toBeLessThan(contiguous.confidence);
  });
});

describe("summarizeAttempts", () => {
  it("reports the most explanatory failure, not the last one tried", () => {
    // Caterpillar, from a live run: the real site timed out, but the last
    // candidate tried was a made-up domain with no DNS record.
    const reason = summarizeAttempts([
      { domain: "caterpillar.com", outcome: "timeout" },
      { domain: "caterpillar.in", outcome: "no_dns" },
      { domain: "caterpillar.co", outcome: "no_dns" },
    ]);

    expect(reason).toBe("timeout");
  });

  it("treats a refusing site as blocked, distinct from a missing page", () => {
    expect(summarizeAttempts([{ domain: "a.com", outcome: "http_403" }])).toBe("blocked");
    expect(summarizeAttempts([{ domain: "a.com", outcome: "http_429" }])).toBe("blocked");
    expect(summarizeAttempts([{ domain: "a.com", outcome: "http_404" }])).toBe("not_found");
    expect(summarizeAttempts([{ domain: "a.com", outcome: "http_503" }])).toBe("server_error");
  });

  it("prefers a positive finding over a transport failure", () => {
    const reason = summarizeAttempts([
      { domain: "a.com", outcome: "no_dns" },
      { domain: "a.in", outcome: "name_mismatch" },
      { domain: "a.io", outcome: "tls" },
    ]);

    expect(reason).toBe("name_mismatch");
  });

  it("falls back cleanly when there is nothing to attribute", () => {
    expect(summarizeAttempts([])).toBe("no_candidates");
  });
});

describe("candidateDomains for academic institutions", () => {
  it("tries academic TLDs for a university, which .com guessing never reaches", () => {
    const candidates = candidateDomains("PES University");

    expect(candidates).toContain("pes.edu");
    expect(candidates).toContain("pes.ac.in");
    expect(candidates.indexOf("pes.edu")).toBeLessThan(candidates.indexOf("pesuniversity.com"));
  });

  it("does not add academic TLDs for an ordinary company", () => {
    expect(candidateDomains("Razorpay").some((c) => c.endsWith(".edu"))).toBe(false);
  });
});

describe("isRegistryWorthy", () => {
  it("keeps a confident full-name match out of nothing and a weak one out of the registry", async () => {
    const { isRegistryWorthy } = await import("../src/network-scan/registry.js");

    expect(isRegistryWorthy({ confidence: 0.95 })).toBe(true);
    // "Tata Consultancy Services" -> tata.com: right family, wrong employer.
    expect(isRegistryWorthy({ confidence: 0.72, partial_name: true })).toBe(false);
    expect(isRegistryWorthy({ confidence: 0.7, weak_name: true })).toBe(false);
    expect(isRegistryWorthy({ confidence: 0.8 })).toBe(false);
  });
});

describe("robots crawl-delay", () => {
  it("is parsed for the matching agent group rather than ignored", () => {
    const policy = parseRobots("User-agent: *\nCrawl-delay: 2.5\nDisallow: /private\n");
    expect(policy.crawlDelayMs).toBe(2500);
  });
});
