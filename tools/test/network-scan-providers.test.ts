import { describe, expect, it } from "vitest";
import { ADAPTERS, getAdapter } from "../src/network-scan/providers/index.js";
import { greenhouse } from "../src/network-scan/providers/greenhouse.js";
import { lever } from "../src/network-scan/providers/lever.js";
import { ashby } from "../src/network-scan/providers/ashby.js";
import { smartrecruiters } from "../src/network-scan/providers/smartrecruiters.js";
import { workday } from "../src/network-scan/providers/workday.js";
import { recruitee } from "../src/network-scan/providers/recruitee.js";
import { workable } from "../src/network-scan/providers/workable.js";
import { fingerprint } from "../src/network-scan/fingerprint.js";
import type { FetchSpec } from "../src/network-scan/providers/types.js";

/** Runs an adapter's fingerprints the way the detector does. */
function detect(adapter: (typeof ADAPTERS)[number], text: string) {
  for (const pattern of adapter.fingerprints) {
    const match = pattern.exec(text);
    if (match) return adapter.accountFrom(match, text);
  }
  return null;
}

describe("adapter registry", () => {
  it("exposes each adapter under its own id, with no duplicates", () => {
    const ids = ADAPTERS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(getAdapter(id)?.id).toBe(id);
  });

  it("every adapter normalizes without touching the network", () => {
    for (const adapter of ADAPTERS) {
      expect(() => adapter.normalize({}, { id: "x", extra: {} })).not.toThrow();
      expect(adapter.normalize({}, { id: "x", extra: {} }).jobs).toEqual([]);
    }
  });
});

describe("greenhouse", () => {
  it("extracts the board token from embed and board URLs", () => {
    expect(detect(greenhouse, 'src="https://boards.greenhouse.io/embed/job_board?for=acmecorp"')).toEqual({
      id: "acmecorp",
    });
    expect(detect(greenhouse, "https://job-boards.greenhouse.io/exampleco/jobs/123")).toEqual({
      id: "exampleco",
    });
  });

  it("normalizes a board payload", () => {
    const page = greenhouse.normalize(
      {
        jobs: [
          {
            id: 4567,
            title: "Senior Frontend Engineer",
            absolute_url: "https://job-boards.greenhouse.io/exampleco/jobs/4567",
            updated_at: "2026-08-01T00:00:00Z",
            location: { name: "Bengaluru, India" },
            offices: [{ name: "Bengaluru" }, { name: "Remote - India" }],
            departments: [{ name: "Engineering" }],
            content: "&lt;p&gt;Build things&lt;/p&gt;",
          },
        ],
      },
      { id: "exampleco" }
    );

    expect(page.jobs).toHaveLength(1);
    expect(page.jobs[0]).toMatchObject({
      providerJobId: "4567",
      title: "Senior Frontend Engineer",
      department: "Engineering",
      // "Remote - India" is an office, not a location, but still signals remote.
      remote: true,
    });
    // `location` wins over `offices` — see the placeholder/business-unit test below.
    expect(page.jobs[0].locations).toEqual(["Bengaluru, India"]);
    expect(page.hasMore).toBe(false);
  });

  // The guard that the whole pipeline rests on: a board token is only trusted
  // when the provider itself says the board belongs to this employer.
  it("verifies a board against the employer name the provider reports", async () => {
    const fetchJson = async (spec: FetchSpec) =>
      spec.url.includes("razorpaysoftwareprivatelimited")
        ? { name: "Razorpay Software Private Limited" }
        : { name: "Some Other Company" };

    await expect(
      greenhouse.verify!({ id: "razorpaysoftwareprivatelimited" }, "Razorpay", fetchJson)
    ).resolves.toMatchObject({ ok: true });

    await expect(greenhouse.verify!({ id: "collins" }, "Collins Aerospace", fetchJson)).resolves.
      toMatchObject({ ok: false });
  });
});

describe("lever", () => {
  it("extracts the board token and normalizes postings", () => {
    expect(detect(lever, "https://jobs.lever.co/exampleco/abc-123")).toEqual({ id: "exampleco" });

    const page = lever.normalize(
      [
        {
          id: "abc-123",
          text: "Backend Engineer",
          hostedUrl: "https://jobs.lever.co/exampleco/abc-123",
          applyUrl: "https://jobs.lever.co/exampleco/abc-123/apply",
          createdAt: 1767225600000,
          categories: {
            location: "Remote - EU",
            team: "Platform",
            commitment: "Full-time",
            workplaceType: "remote",
          },
          descriptionPlain: "Work on the platform",
        },
      ],
      { id: "exampleco" }
    );

    expect(page.jobs[0]).toMatchObject({
      providerJobId: "abc-123",
      title: "Backend Engineer",
      department: "Platform",
      employmentType: "Full-time",
      remote: true,
    });
    expect(page.jobs[0].publishedAt).toMatch(/^2026-/);
  });
});

describe("ashby", () => {
  it("normalizes postings including compensation and secondary locations", () => {
    const page = ashby.normalize(
      {
        jobs: [
          {
            id: "job-1",
            title: "Product Engineer",
            location: "London",
            secondaryLocations: [{ location: "Berlin" }],
            isRemote: false,
            department: "Engineering",
            employmentType: "FullTime",
            jobUrl: "https://jobs.ashbyhq.com/exampleco/job-1",
            publishedAt: "2026-07-01T00:00:00Z",
            compensation: {
              scrapeableCompensationSalarySummary: {
                minValue: 90000,
                maxValue: 120000,
                currencyCode: "GBP",
                interval: "YEAR",
              },
            },
          },
        ],
      },
      { id: "exampleco" }
    );

    expect(page.jobs[0].locations).toEqual(["London", "Berlin"]);
    expect(page.jobs[0].compensation).toMatchObject({ min: 90000, max: 120000, currency: "GBP" });
  });
});

describe("smartrecruiters", () => {
  it("pages until the reported total is reached", () => {
    const content = Array.from({ length: 100 }, (_, i) => ({
      id: `job-${i}`,
      name: `Engineer ${i}`,
      location: { city: "Chennai", country: "India" },
    }));

    const first = smartrecruiters.normalize({ content, totalFound: 250, offset: 0 }, { id: "Example" });
    expect(first.hasMore).toBe(true);
    expect(first.total).toBe(250);
    expect(first.jobs[0].jobUrl).toContain("jobs.smartrecruiters.com/Example/job-0");

    const last = smartrecruiters.normalize(
      { content: content.slice(0, 50), totalFound: 250, offset: 200 },
      { id: "Example" }
    );
    expect(last.hasMore).toBe(false);
  });

  it("preserves the board token's exact case, which the API requires", () => {
    expect(detect(smartrecruiters, "https://careers.smartrecruiters.com/Freshworks")).toEqual({
      id: "Freshworks",
    });
  });
});

describe("workday", () => {
  it("captures tenant, data centre and site — none of which can be guessed", () => {
    const account = detect(
      workday,
      "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite"
    );

    expect(account).toEqual({
      id: "nvidia/wd5/NVIDIAExternalCareerSite",
      extra: { tenant: "nvidia", dc: "wd5", site: "NVIDIAExternalCareerSite" },
    });
  });

  it("builds a POST endpoint with offset paging", () => {
    const account = { id: "x", extra: { tenant: "nvidia", dc: "wd5", site: "Site" } };
    const spec = workday.endpoint(account, 3);

    expect(spec.method).toBe("POST");
    expect(spec.url).toBe("https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/Site/jobs");
    expect(JSON.parse(spec.body!)).toMatchObject({ limit: 20, offset: 60 });
  });

  it("normalizes postings and reports more pages when a full page comes back", () => {
    const account = { id: "x", extra: { tenant: "nvidia", dc: "wd5", site: "Site" } };
    const postings = Array.from({ length: 20 }, (_, i) => ({
      title: `Engineer ${i}`,
      externalPath: `/job/Engineer-${i}`,
      locationsText: "Bengaluru, India",
    }));

    const page = workday.normalize({ jobPostings: postings, total: 2000 }, account);
    expect(page.hasMore).toBe(true);
    expect(page.total).toBe(2000);
    expect(page.jobs[0].jobUrl).toBe(
      "https://nvidia.wd5.myworkdayjobs.com/Site/job/Engineer-0"
    );
  });

  it("has no guessAccounts, because a Workday site name cannot be inferred", () => {
    expect(workday.guessAccounts).toBeUndefined();
  });
});

describe("recruitee", () => {
  // Every one of these cases came from a live probe that produced a confident
  // but wrong match before verification existed.
  it("rejects a board belonging to a different company", async () => {
    const fetchJson = async () => ({
      offers: [{ title: "Shift Leader KFC Groningen", company_name: "KFC Nederland (CFE)" }],
    });

    await expect(
      recruitee.verify!({ id: "collins" }, "Collins Aerospace", fetchJson)
    ).resolves.toMatchObject({ ok: false, reportedName: "KFC Nederland (CFE)" });
  });

  it("rejects an abandoned trial board containing only sample postings", async () => {
    const fetchJson = async () => ({
      offers: [{ title: "Senior Marketer (Sample)", company_name: "Google" }],
    });

    const result = await recruitee.verify!({ id: "google" }, "Google", fetchJson);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/sample/i);
  });

  it("accepts a board whose postings name the company", async () => {
    const fetchJson = async () => ({
      offers: [{ title: "Engineer", company_name: "Example Co" }],
    });

    await expect(recruitee.verify!({ id: "exampleco" }, "Example Co", fetchJson)).resolves.
      toMatchObject({ ok: true });
  });

  it("drops sample postings when normalizing", () => {
    const page = recruitee.normalize({
      offers: [
        { id: 1, title: "Senior Marketer (Sample)" },
        { id: 2, title: "Real Engineer", location: "Amsterdam" },
      ],
    }, { id: "exampleco" });

    expect(page.jobs).toHaveLength(1);
    expect(page.jobs[0].title).toBe("Real Engineer");
  });
});

describe("workable", () => {
  it("builds locations from city, region and country", () => {
    const page = workable.normalize(
      {
        jobs: [
          {
            shortcode: "ABC123",
            title: "Data Engineer",
            city: "Pune",
            region: "Maharashtra",
            country: "India",
            telecommuting: false,
            url: "https://apply.workable.com/exampleco/j/ABC123",
          },
        ],
      },
      { id: "exampleco" }
    );

    expect(page.jobs[0].locations).toEqual(["Pune, Maharashtra, India"]);
    expect(page.jobs[0].providerJobId).toBe("ABC123");
  });
});

describe("fingerprint", () => {
  it("identifies a provider linked from a careers page", () => {
    const result = fingerprint(
      '<a href="https://job-boards.greenhouse.io/razorpaysoftwareprivatelimited">Openings</a>',
      "https://razorpay.com/careers/"
    );

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      provider: "greenhouse",
      account: { id: "razorpaysoftwareprivatelimited" },
    });
  });

  it("records providers it recognises but has no adapter for", () => {
    const result = fingerprint(
      '<iframe src="https://example.darwinbox.in/ms/candidate/careers"></iframe>',
      "https://example.com/careers"
    );

    expect(result.matches).toHaveLength(0);
    expect(result.unsupported[0]).toMatchObject({ provider: "darwinbox", account: "example" });
  });

  it("matches against the page URL as well as its body", () => {
    const result = fingerprint(
      "<html></html>",
      "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite"
    );

    expect(result.matches[0].provider).toBe("workday");
  });

  it("finds nothing in a page with no ATS markers", () => {
    const result = fingerprint("<html><body>We are hiring!</body></html>", "https://x.com/careers");
    expect(result.matches).toHaveLength(0);
    expect(result.unsupported).toHaveLength(0);
  });
});

describe("workday tenant variations", () => {
  // Found live: Accenture's Workday returns no locationsText at all — the
  // location sits in bulletFields next to the requisition id, unlabelled.
  it("reads the location out of bulletFields when locationsText is absent", () => {
    const account = { id: "x", extra: { tenant: "accenture", dc: "wd103", site: "Careers" } };
    const page = workday.normalize(
      {
        jobPostings: [
          {
            title: "Security Operations Center Manager",
            externalPath: "/job/Arlington/Security-Ops_R00353580",
            postedOn: "Posted Today",
            bulletFields: ["R00353580", "Arlington, 1201 Wilson, Corp"],
          },
        ],
      },
      account
    );

    expect(page.jobs[0].providerJobId).toBe("R00353580");
    expect(page.jobs[0].locations).toEqual(["Arlington, 1201 Wilson, Corp"]);
  });

  it("still prefers locationsText where the tenant provides it", () => {
    const account = { id: "x", extra: { tenant: "nvidia", dc: "wd5", site: "Site" } };
    const page = workday.normalize(
      {
        jobPostings: [
          {
            title: "IC Test Lab Specialist",
            externalPath: "/job/1",
            locationsText: "Bengaluru, India",
            bulletFields: ["JR1988421"],
          },
        ],
      },
      account
    );

    expect(page.jobs[0].locations).toEqual(["Bengaluru, India"]);
    expect(page.jobs[0].providerJobId).toBe("JR1988421");
  });

  it("does not mistake a location for a requisition id", () => {
    const account = { id: "x", extra: { tenant: "t", dc: "wd1", site: "S" } };
    const page = workday.normalize(
      { jobPostings: [{ title: "Engineer", externalPath: "/j/1", bulletFields: ["Pune, India"] }] },
      account
    );

    expect(page.jobs[0].locations).toEqual(["Pune, India"]);
  });
});

describe("greenhouse location fields", () => {
  // Found live: Razorpay's board puts business units in `offices`
  // ("RazorpayX", "Payments") while the real place sits in `location`.
  it("prefers location over offices, which boards repurpose for business units", () => {
    const page = greenhouse.normalize(
      {
        jobs: [
          {
            id: 1,
            title: "Engineer",
            location: { name: "Bengaluru" },
            offices: [{ name: "RazorpayX" }, { name: "Payments" }],
          },
        ],
      },
      { id: "b" }
    );

    expect(page.jobs[0].locations).toEqual(["Bengaluru"]);
  });

  it("drops Greenhouse's I18N placeholder rather than reporting it as a place", () => {
    const page = greenhouse.normalize(
      { jobs: [{ id: 1, title: "Engineer", offices: [{ name: "I18N" }, { name: "Berlin" }] }] },
      { id: "b" }
    );

    expect(page.jobs[0].locations).toEqual(["Berlin"]);
  });

  it("falls back to offices when the job carries no location", () => {
    const page = greenhouse.normalize(
      { jobs: [{ id: 1, title: "Engineer", offices: [{ name: "London" }] }] },
      { id: "b" }
    );

    expect(page.jobs[0].locations).toEqual(["London"]);
  });
});
