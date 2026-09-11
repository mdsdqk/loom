import { describe, expect, it } from "vitest";
import {
  dedupeJobs,
  fetchJobsForSource,
  jobIdentity,
  matchPreferences,
} from "../src/network-scan/jobs.js";
import { careerLinksFrom, careerUrlsFromSitemap, looksLikeCareersPage } from "../src/network-scan/careers.js";
import { buildReport, leverageScore } from "../src/network-scan/report.js";
import { runPaths, resolveCandidateDir, CANDIDATE_DIR_ENV } from "../src/network-scan/paths.js";
import type { HttpClient } from "../src/network-scan/http/client.js";
import type { CandidatePreferences, Company, HiringSource, Job } from "../src/network-scan/schema.js";

const preferences: CandidatePreferences = {
  titles: ["Full Stack Engineer", "Frontend Developer", "Software Engineer"],
  locations: ["Bengaluru", "Berlin"],
  job_types: ["Full-time"],
  industries: [],
};

function jsonClient(pages: Record<string, unknown>): HttpClient {
  return {
    stats: { requests: 0, cacheHits: 0, failures: 0 },
    request: async ({ url }: { url: string }) => {
      const payload = pages[url];
      if (payload === undefined) {
        return { kind: "response", ok: false, status: 404, finalUrl: url, contentType: "application/json", body: "", truncated: false, fromCache: false };
      }
      return {
        kind: "response",
        ok: true,
        status: 200,
        finalUrl: url,
        contentType: "application/json",
        body: JSON.stringify(payload),
        truncated: false,
        fromCache: false,
      };
    },
  } as unknown as HttpClient;
}

describe("jobIdentity", () => {
  it("prefers the provider's own job id", () => {
    expect(jobIdentity("acme", "greenhouse", { providerJobId: "42", title: "X", locations: [] }))
      .toBe("greenhouse:42");
  });

  it("falls back to a canonical URL, ignoring query and fragment", () => {
    const a = jobIdentity("acme", "lever", {
      title: "X",
      locations: [],
      jobUrl: "https://jobs.lever.co/acme/1?utm=x#top",
    });
    const b = jobIdentity("acme", "lever", {
      title: "X",
      locations: [],
      jobUrl: "https://jobs.lever.co/acme/1",
    });
    expect(a).toBe(b);
  });

  it("never collapses two distinct roles that share a title", () => {
    const bengaluru = jobIdentity("acme", "html", {
      title: "Senior Software Engineer",
      locations: ["Bengaluru"],
    });
    const berlin = jobIdentity("acme", "html", {
      title: "Senior Software Engineer",
      locations: ["Berlin"],
    });
    expect(bengaluru).not.toBe(berlin);
  });

  it("treats title casing and punctuation as the same job", () => {
    expect(
      jobIdentity("acme", "html", { title: "Senior  Engineer!", locations: ["Bengaluru"] })
    ).toBe(jobIdentity("acme", "html", { title: "senior engineer", locations: ["bengaluru"] }));
  });
});

describe("matchPreferences", () => {
  it("matches a title the candidate actually listed", () => {
    const result = matchPreferences(
      { title: "Senior Software Engineer", locations: ["Bengaluru"], remote: false, employment_type: "Full-time" },
      preferences
    );
    expect(result.matches).toBe(true);
    expect(result.matchedOn).toContain("title:Software Engineer");
    expect(result.matchedOn).toContain("location:Bengaluru");
  });

  it("does not match on location alone", () => {
    const result = matchPreferences(
      { title: "Chief Marketing Officer", locations: ["Bengaluru"], remote: false, employment_type: undefined },
      preferences
    );
    expect(result.matches).toBe(false);
  });

  // Title-only matching surfaced Seattle and Melbourne postings to a candidate
  // targeting Bengaluru, burying 150 real leads under a thousand irrelevant ones.
  it("rejects the right title in a location the candidate did not ask for", () => {
    const result = matchPreferences(
      { title: "Software Engineer", locations: ["Seattle, Washington, USA"], remote: false, employment_type: undefined },
      preferences
    );

    expect(result.matches).toBe(false);
    expect(result.matchedOn).toContain("title:Software Engineer");
  });

  it("keeps a remote job regardless of where it is nominally based", () => {
    const result = matchPreferences(
      { title: "Software Engineer", locations: ["Seattle, Washington, USA"], remote: true, employment_type: undefined },
      preferences
    );
    expect(result.matches).toBe(true);
  });

  it("keeps a job whose location the provider did not report", () => {
    const result = matchPreferences(
      { title: "Software Engineer", locations: [], remote: false, employment_type: undefined },
      preferences
    );
    expect(result.matches).toBe(true);
  });

  it("ignores location entirely when the candidate named none", () => {
    const result = matchPreferences(
      { title: "Software Engineer", locations: ["Anywhere at all"], remote: false, employment_type: undefined },
      { ...preferences, locations: [] }
    );
    expect(result.matches).toBe(true);
  });

  it("counts remote as a location hit when the candidate named locations", () => {
    const result = matchPreferences(
      { title: "Frontend Developer", locations: ["Anywhere"], remote: true, employment_type: undefined },
      preferences
    );
    expect(result.matches).toBe(true);
    expect(result.matchedOn).toContain("location:remote");
  });

  it("requires every word of a multi-word preferred title", () => {
    const result = matchPreferences(
      { title: "Stack Engineer", locations: [], remote: false, employment_type: undefined },
      { ...preferences, titles: ["Full Stack Engineer"] }
    );
    expect(result.matches).toBe(false);
  });
});

describe("fetchJobsForSource", () => {
  const source: HiringSource = {
    company_id: "exampleco",
    provider: "greenhouse",
    account: "exampleco",
    confidence: 0.95,
    status: "active",
  };

  it("fetches, normalizes and tags against preferences", async () => {
    const client = jsonClient({
      "https://boards-api.greenhouse.io/v1/boards/exampleco/jobs?content=true": {
        jobs: [
          { id: 1, title: "Software Engineer", location: { name: "Bengaluru" }, absolute_url: "https://x/1" },
          { id: 2, title: "Warehouse Associate", location: { name: "Pune" }, absolute_url: "https://x/2" },
        ],
      },
    });

    const result = await fetchJobsForSource(source, {
      client,
      companyName: "Example Co",
      preferences,
      now: () => "2026-09-08T00:00:00.000Z",
    });

    expect(result.error).toBeUndefined();
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0].matches_preferences).toBe(true);
    expect(result.jobs[1].matches_preferences).toBe(false);
    expect(result.jobs[0].company_name).toBe("Example Co");
  });

  it("reports a fetch failure instead of throwing, so one board cannot abort a scan", async () => {
    const result = await fetchJobsForSource(source, {
      client: jsonClient({}),
      companyName: "Example Co",
      preferences,
    });

    expect(result.jobs).toEqual([]);
    expect(result.error).toMatch(/HTTP 404/);
  });

  it("refuses a provider it has no adapter for", async () => {
    const result = await fetchJobsForSource(
      { ...source, provider: "unsupported:darwinbox" },
      { client: jsonClient({}), companyName: "Example Co", preferences }
    );
    expect(result.error).toMatch(/no adapter/);
  });

  it("stops at the page cap on a provider that always reports more", async () => {
    const postings = Array.from({ length: 20 }, (_, i) => ({
      title: `Engineer ${i}`,
      externalPath: `/job/${i}`,
      locationsText: "Bengaluru",
    }));
    const client = jsonClient({
      "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Site/jobs": {
        jobPostings: postings,
        total: 100000,
      },
    });

    const result = await fetchJobsForSource(
      {
        company_id: "acme",
        provider: "workday",
        account: "acme/wd5/Site",
        account_extra: { tenant: "acme", dc: "wd5", site: "Site" },
        confidence: 0.95,
        status: "active",
      },
      { client, companyName: "Acme", preferences, maxPages: 3 }
    );

    expect(result.pages).toBe(3);
    // Every page returns the same postings, so dedupe by identity keeps 20.
    expect(result.jobs).toHaveLength(20);
  });
});

describe("dedupeJobs", () => {
  it("collapses repeats across sources and counts them", () => {
    const job = (id: string): Job => ({
      id,
      company_id: "acme",
      company_name: "Acme",
      title: "Engineer",
      locations: [],
      source: { provider: "greenhouse", fetched_at: "2026-09-08T00:00:00.000Z" },
      matches_preferences: false,
      matched_on: [],
    });

    const result = dedupeJobs([job("a"), job("b"), job("a")]);
    expect(result.jobs).toHaveLength(2);
    expect(result.removed).toBe(1);
  });
});

describe("careers discovery helpers", () => {
  it("accepts a careers-looking URL whose body mentions roles", () => {
    expect(
      looksLikeCareersPage("<h1>Open roles</h1><p>Apply now</p>", "https://x.com/careers")
    ).toBe(true);
  });

  it("rejects a careers URL that returned an unrelated page", () => {
    expect(looksLikeCareersPage("<h1>Buy shoes</h1>", "https://x.com/careers")).toBe(false);
  });

  it("rejects a page whose URL is not careers-like at all", () => {
    expect(looksLikeCareersPage("<h1>Jobs and roles, apply</h1>", "https://x.com/about")).toBe(false);
  });

  it("finds career links by href or anchor text, resolved against the page", () => {
    const links = careerLinksFrom(
      '<a href="/en/careers">Work with us</a><a href="/pricing">Pricing</a>',
      "https://x.com/"
    );
    expect(links).toContain("https://x.com/en/careers");
    expect(links.some((l) => l.includes("pricing"))).toBe(false);
  });

  // An off-site "Jobs" link is very often a partner's, a parent's or an
  // agency's board. Following one lets another employer's postings be
  // attributed to this company.
  it("refuses to follow a careers link that leaves the company's own site", () => {
    const links = careerLinksFrom(
      '<a href="https://other-company.com/jobs">Jobs</a><a href="https://jobs.lever.co/someoneelse">Roles</a>',
      "https://x.com/"
    );
    expect(links).toEqual([]);
  });

  it("still follows a careers subdomain, which is the same site", () => {
    const links = careerLinksFrom('<a href="https://careers.x.com/">Careers</a>', "https://www.x.com/");
    expect(links).toContain("https://careers.x.com/");
  });

  it("picks career URLs and nested indexes out of a sitemap", () => {
    const { pages, indexes } = careerUrlsFromSitemap(
      `<urlset>
         <url><loc>https://x.com/about</loc></url>
         <url><loc>https://x.com/careers/engineer</loc></url>
         <url><loc>https://x.com/sitemap-jobs.xml</loc></url>
       </urlset>`
    );
    expect(pages).toContain("https://x.com/careers/engineer");
    expect(indexes).toContain("https://x.com/sitemap-jobs.xml");
  });
});

describe("paths", () => {
  it("prefers an explicit directory over the environment", () => {
    process.env[CANDIDATE_DIR_ENV] = "/from/env";
    try {
      expect(resolveCandidateDir("/explicit")).toContain("explicit");
      expect(resolveCandidateDir()).toContain("env");
    } finally {
      delete process.env[CANDIDATE_DIR_ENV];
    }
  });

  it("hangs every artifact off the candidate directory, so any candidate can be scanned", () => {
    const a = runPaths("/tmp/candidate-a");
    const b = runPaths("/tmp/candidate-b");

    expect(a.jobs).not.toBe(b.jobs);
    for (const key of ["networkImport", "domains", "hiringSources", "jobs", "report"] as const) {
      expect(a[key]).toContain("candidate-a");
    }
  });
});

describe("report", () => {
  const company = (over: Partial<Company> & { id: string }): Company => ({
    canonical_name: over.id,
    aliases: [],
    connections: [],
    signals: {
      connection_count: 1,
      seniority: { leadership: 0, lead: 0, senior: 0, mid: 1, junior: 0, unknown: 0 },
      saved_job_count: 0,
      followed: false,
      ex_employer: false,
      alumni: false,
    },
    ...over,
  });

  it("ranks an ex-employer above an equally connected stranger", () => {
    const stranger = company({ id: "stranger" });
    const former = company({
      id: "former",
      signals: { ...company({ id: "x" }).signals, ex_employer: true },
    });

    expect(leverageScore(former)).toBeGreaterThan(leverageScore(stranger));
  });

  it("weights senior connections above junior ones", () => {
    const senior = company({
      id: "s",
      signals: {
        ...company({ id: "x" }).signals,
        seniority: { leadership: 1, lead: 0, senior: 0, mid: 0, junior: 0, unknown: 0 },
      },
    });
    const junior = company({
      id: "j",
      signals: {
        ...company({ id: "x" }).signals,
        seniority: { leadership: 0, lead: 0, senior: 0, mid: 0, junior: 1, unknown: 0 },
      },
    });

    expect(leverageScore(senior)).toBeGreaterThan(leverageScore(junior));
  });

  it("renders from the import alone, before any later stage has run", () => {
    const report = buildReport({
      network: {
        source: "export",
        imported_at: "2026-09-08T00:00:00.000Z",
        counts: {
          connection_rows: 10,
          connections_with_company: 9,
          companies: 1,
          dropped_non_employer: 0,
          dropped_blank_company: 1,
          saved_jobs: 0,
          followed_orgs: 0,
        },
        preferences: { titles: [], locations: [], job_types: [], industries: [] },
        companies: [company({ id: "acme", canonical_name: "Acme" })],
        review: [],
        missing_files: [],
      },
    });

    expect(report).toContain("# Network Scan");
    expect(report).toContain("No jobs retrieved yet");
  });
});

describe("truncation reporting", () => {
  // Several boards came back with exactly 800 jobs on a live run — that is the
  // page cap, not the real total, and reporting it as complete is misleading.
  it("flags a board cut short by the page cap", async () => {
    const postings = Array.from({ length: 20 }, (_, i) => ({
      title: `Engineer ${i}`,
      externalPath: `/job/${i}`,
      bulletFields: [`R${1000 + i}`, "Bengaluru"],
    }));
    const client = jsonClient({
      "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Site/jobs": {
        jobPostings: postings,
        total: 5000,
      },
    });

    const result = await fetchJobsForSource(
      {
        company_id: "acme",
        provider: "workday",
        account: "acme/wd5/Site",
        account_extra: { tenant: "acme", dc: "wd5", site: "Site" },
        confidence: 0.95,
        status: "active",
      },
      { client, companyName: "Acme", preferences, maxPages: 2 }
    );

    expect(result.truncated).toBe(true);
    expect(result.reportedTotal).toBe(5000);
  });

  it("does not flag a board that was fetched completely", async () => {
    const client = jsonClient({
      "https://boards-api.greenhouse.io/v1/boards/exampleco/jobs?content=true": {
        jobs: [{ id: 1, title: "Engineer", absolute_url: "https://x/1" }],
      },
    });

    const result = await fetchJobsForSource(
      { company_id: "exampleco", provider: "greenhouse", account: "exampleco", confidence: 0.95, status: "active" },
      { client, companyName: "Example Co", preferences, maxPages: 10 }
    );

    expect(result.truncated).toBe(false);
  });
});

describe("preference matching uses whole tokens", () => {
  // Substring matching marks Indiana for "India" and JavaScript for "Java".
  it("does not match a location that merely contains the preferred one", () => {
    const result = matchPreferences(
      { title: "Software Engineer", locations: ["Indianapolis, Indiana"], remote: false, employment_type: undefined },
      { titles: ["Software Engineer"], locations: ["India"], job_types: [], industries: [] }
    );

    expect(result.matchedOn).not.toContain("location:India");
  });

  it("still matches the location when it is genuinely present", () => {
    const result = matchPreferences(
      { title: "Software Engineer", locations: ["Bengaluru, India"], remote: false, employment_type: undefined },
      { titles: ["Software Engineer"], locations: ["India"], job_types: [], industries: [] }
    );

    expect(result.matchedOn).toContain("location:India");
  });

  it("does not match a title that merely contains the preferred word", () => {
    const result = matchPreferences(
      { title: "JavaScript Developer", locations: [], remote: false, employment_type: undefined },
      { titles: ["Java"], locations: [], job_types: [], industries: [] }
    );

    expect(result.matches).toBe(false);
  });
});

describe("job fetching honours robots.txt", () => {
  it("refuses an endpoint the host disallows", async () => {
    const result = await fetchJobsForSource(
      { company_id: "acme", provider: "greenhouse", account: "acme", confidence: 0.95, status: "active" },
      {
        client: jsonClient({}),
        companyName: "Acme",
        preferences,
        robots: { allows: async () => false },
      }
    );

    expect(result.jobs).toEqual([]);
    expect(result.error).toMatch(/robots/i);
  });
});

describe("dedupe is deterministic when companies share a board", () => {
  // Amazon and Amazon Web Services both resolve to amazon.jobs, so the same
  // postings arrive twice. Which record keeps them must not depend on which
  // fetch finished first.
  const shared = (companyId: string): Job => ({
    id: "amazon:123",
    company_id: companyId,
    company_name: companyId,
    title: "Engineer",
    locations: [],
    source: { provider: "amazon", fetched_at: "2026-09-09T00:00:00.000Z" },
    matches_preferences: false,
    matched_on: [],
  });

  const rank = (id: string) => (id === "amazon" ? 15 : 8);

  it("gives the posting to the better-connected company regardless of order", () => {
    const forwards = dedupeJobs([shared("amazon"), shared("amazon-web-services")], rank);
    const backwards = dedupeJobs([shared("amazon-web-services"), shared("amazon")], rank);

    expect(forwards.jobs[0].company_id).toBe("amazon");
    expect(backwards.jobs[0].company_id).toBe("amazon");
    expect(forwards.removed).toBe(1);
  });

  it("breaks ties on company id rather than arrival order", () => {
    const flat = () => 0;
    const forwards = dedupeJobs([shared("zeta"), shared("alpha")], flat);
    const backwards = dedupeJobs([shared("alpha"), shared("zeta")], flat);

    expect(forwards.jobs[0].company_id).toBe("alpha");
    expect(backwards.jobs[0].company_id).toBe("alpha");
  });
});
