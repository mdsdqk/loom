import { describe, expect, it } from "vitest";
import {
  locationCompatible,
  structuralVerdict,
  titleLevel,
} from "../src/network-scan/matching/structural.js";
import { collapseVariants } from "../src/network-scan/matching/collapse.js";
import {
  calibrate,
  formatCalibration,
  isSameRole,
  parseSavedJobs,
} from "../src/network-scan/matching/calibration.js";
import { classifyTitle, familyVerdict } from "../src/network-scan/matching/taxonomy.js";
import type { CandidatePreferences, Job } from "../src/network-scan/schema.js";

const preferences: CandidatePreferences = {
  titles: ["Software Engineer"],
  locations: ["Bengaluru", "Berlin"],
  job_types: ["Full-time"],
  industries: [],
};

function job(over: Partial<Job> & { id: string; title: string }): Job {
  return {
    company_id: "acme",
    company_name: "Acme",
    locations: [],
    source: { provider: "greenhouse", fetched_at: "2026-09-09T00:00:00.000Z" },
    matches_preferences: false,
    matched_on: [],
    ...over,
  };
}

describe("titleLevel", () => {
  it.each([
    ["Software Engineer Intern", "intern"],
    ["Graduate Program - Engineering", "intern"],
    ["Junior Developer", "junior"],
    ["Associate Software Engineer", "junior"],
    ["Software Engineer", "mid"],
    ["Senior Software Engineer", "senior"],
    ["Software Engineer III", "senior"],
    ["Staff Engineer", "lead"],
    ["Principal Architect", "lead"],
    ["Engineering Manager", "lead"],
    ["Director of Engineering", "executive"],
    ["VP, Platform", "executive"],
    ["Chief Technology Officer", "executive"],
  ])("reads %j as %s", (title, expected) => {
    expect(titleLevel(title)).toBe(expected);
  });

  it("prefers the most senior signal in a compound title", () => {
    // "Senior Engineering Manager" is a lead role, not a senior IC one.
    expect(titleLevel("Senior Engineering Manager")).toBe("lead");
    expect(titleLevel("Senior Director, Engineering")).toBe("executive");
  });
});

describe("locationCompatible", () => {
  it("keeps a job in a wanted city", () => {
    expect(locationCompatible(job({ id: "1", title: "X", locations: ["Bengaluru, India"] }), preferences)).toBe(true);
  });

  it("rejects a job somewhere the candidate did not ask for", () => {
    expect(locationCompatible(job({ id: "1", title: "X", locations: ["Seattle, WA"] }), preferences)).toBe(false);
  });

  it("keeps remote work wherever it is nominally based", () => {
    expect(locationCompatible(job({ id: "1", title: "X", locations: ["Seattle"], remote: true }), preferences)).toBe(true);
  });

  it("keeps a job whose location the provider never reported", () => {
    expect(locationCompatible(job({ id: "1", title: "X", locations: [] }), preferences)).toBe(true);
  });

  it("does not match a city that merely contains the wanted name", () => {
    // "India" must not match "Indianapolis".
    const indiana = job({ id: "1", title: "X", locations: ["Indianapolis, Indiana"] });
    expect(locationCompatible(indiana, { ...preferences, locations: ["India"] })).toBe(false);
  });
});

describe("structuralVerdict", () => {
  it("rejects a role below the target level and says why", () => {
    const verdict = structuralVerdict(
      job({ id: "1", title: "Software Engineer Intern", locations: ["Bengaluru"] }),
      { preferences, minLevel: "mid" }
    );

    expect(verdict.keep).toBe(false);
    expect(verdict.stage).toBe("seniority");
    expect(verdict.reason).toMatch(/below/);
  });

  it("rejects a role above the target level", () => {
    const verdict = structuralVerdict(
      job({ id: "1", title: "VP of Engineering", locations: ["Bengaluru"] }),
      { preferences, maxLevel: "lead" }
    );

    expect(verdict.keep).toBe(false);
    expect(verdict.stage).toBe("seniority");
  });

  it("keeps a role inside the level window", () => {
    const verdict = structuralVerdict(
      job({ id: "1", title: "Senior Software Engineer", locations: ["Bengaluru"] }),
      { preferences, minLevel: "mid", maxLevel: "lead" }
    );
    expect(verdict.keep).toBe(true);
  });

  it("rejects an unwanted employment type only when the job states one", () => {
    const stated = structuralVerdict(
      job({ id: "1", title: "Software Engineer", locations: ["Bengaluru"], employment_type: "Internship" }),
      { preferences }
    );
    expect(stated.keep).toBe(false);
    expect(stated.stage).toBe("employment_type");

    const silent = structuralVerdict(
      job({ id: "2", title: "Software Engineer", locations: ["Bengaluru"] }),
      { preferences }
    );
    expect(silent.keep).toBe(true);
  });

  it("drops a stale posting but keeps one with no date", () => {
    const now = new Date("2026-09-09T00:00:00.000Z");

    const stale = structuralVerdict(
      job({ id: "1", title: "Software Engineer", locations: ["Bengaluru"], published_at: "2026-01-01" }),
      { preferences, maxAgeDays: 60, now }
    );
    expect(stale.keep).toBe(false);
    expect(stale.stage).toBe("freshness");

    const undated = structuralVerdict(
      job({ id: "2", title: "Software Engineer", locations: ["Bengaluru"] }),
      { preferences, maxAgeDays: 60, now }
    );
    expect(undated.keep).toBe(true);
  });

  it("ignores an unparseable date rather than discarding the job", () => {
    const verdict = structuralVerdict(
      job({ id: "1", title: "Software Engineer", locations: ["Bengaluru"], published_at: "Posted Today" }),
      { preferences, maxAgeDays: 30, now: new Date("2026-09-09") }
    );
    expect(verdict.keep).toBe(true);
  });
});

describe("collapseVariants", () => {
  // Target listed one role 138 times, once per store location.
  const sameRole = [
    job({ id: "gh:1", title: "Security Specialist", locations: ["Austin, TX"], job_url: "https://x/1" }),
    job({ id: "gh:2", title: "Security Specialist", locations: ["Dallas, TX"], job_url: "https://x/2" }),
    job({ id: "gh:3", title: "Security Specialist", locations: ["Reno, NV"], job_url: "https://x/3" }),
  ];

  it("merges one role posted per location into a single row", () => {
    const result = collapseVariants(sameRole);

    expect(result.jobs).toHaveLength(1);
    expect(result.merged).toBe(2);
    expect(result.jobs[0].variant_count).toBe(3);
    expect(result.jobs[0].all_locations).toEqual(["Austin, TX", "Dallas, TX", "Reno, NV"]);
  });

  it("keeps every posting's URL so no application route is lost", () => {
    expect(collapseVariants(sameRole).jobs[0].variant_urls).toEqual([
      "https://x/1",
      "https://x/2",
      "https://x/3",
    ]);
  });

  it("does not merge different seniorities of the same role", () => {
    const result = collapseVariants([
      job({ id: "a", title: "Software Engineer" }),
      job({ id: "b", title: "Senior Software Engineer" }),
    ]);
    expect(result.jobs).toHaveLength(2);
  });

  it("does not merge the same title across different companies", () => {
    const result = collapseVariants([
      job({ id: "a", title: "Software Engineer", company_id: "acme" }),
      job({ id: "b", title: "Software Engineer", company_id: "other" }),
    ]);
    expect(result.jobs).toHaveLength(2);
  });

  it("treats a role as remote if any of its postings is", () => {
    const result = collapseVariants([
      job({ id: "a", title: "Engineer", locations: ["Austin"] }),
      job({ id: "b", title: "Engineer", locations: ["Remote"], remote: true }),
    ]);
    expect(result.jobs[0].remote).toBe(true);
  });

  it("produces the same output regardless of input order", () => {
    const forwards = collapseVariants(sameRole).jobs.map((j) => j.id);
    const backwards = collapseVariants([...sameRole].reverse()).jobs.map((j) => j.id);
    expect(forwards).toEqual(backwards);
  });
});

describe("calibration against saved jobs", () => {
  const saved = parseSavedJobs([
    { "Saved Date": "7/28/26", "Job Url": "https://x/1", "Job Title": "Senior Software Engineer", "Company Name": "Acme Inc." },
    { "Saved Date": "7/26/26", "Job Url": "https://x/2", "Job Title": "Data Analyst", "Company Name": "Acme Inc." },
    { "Saved Date": "7/20/26", "Job Url": "https://x/3", "Job Title": "Platform Engineer", "Company Name": "Nowhere Ltd" },
  ]);

  const scanned = [
    job({ id: "1", title: "Senior Software Engineer (Remote)", company_name: "Acme" }),
    job({ id: "2", title: "Data Analyst", company_name: "Acme" }),
  ];

  it("normalizes company names so export and board spellings line up", () => {
    expect(saved[0].companyKey).toBe("acme");
  });

  it("counts a saved job the matcher kept and one it discarded", () => {
    const result = calibrate(saved, scanned, (j) =>
      j.title.includes("Data Analyst") ? "discipline" : null
    );

    expect(result.reachable).toBe(2);
    expect(result.found).toBe(2);
    expect(result.kept).toBe(1);
    expect(result.missed).toEqual([
      { title: "Data Analyst", company: "Acme Inc.", rejectedBy: "discipline" },
    ]);
  });

  it("separates a coverage gap from a matcher fault", () => {
    const result = calibrate(saved, scanned, () => null);

    // Nowhere Ltd was never scanned — that is not the matcher's failure.
    expect(result.unreachable).toEqual([{ title: "Platform Engineer", company: "Nowhere Ltd" }]);
    expect(result.reachable).toBe(2);
  });

  it("names every discarded job in the summary, not just a count", () => {
    const text = formatCalibration(
      calibrate(saved, scanned, (j) => (j.title.includes("Data") ? "discipline" : null))
    );

    expect(text).toContain("Acme Inc. — Data Analyst");
    expect(text).toMatch(/recall 50%/);
    expect(text).toMatch(/positive-only/);
  });
});

describe("isSameRole", () => {
  it("tolerates suffixes the board adds", () => {
    expect(isSameRole("Senior Software Engineer", "Senior Software Engineer (Remote)")).toBe(true);
    expect(isSameRole("Software Engineer", "Software Engineer II - Payments")).toBe(true);
  });

  it("does not conflate different roles that share words", () => {
    expect(isSameRole("Data Analyst", "Data Engineer")).toBe(false);
    expect(isSameRole("Senior Software Engineer", "Marketing Manager")).toBe(false);
  });
});

describe("classifyTitle", () => {
  it.each([
    ["Senior Software Engineer", "engineering"],
    ["Full Stack Developer", "engineering"],
    ["SDE II", "engineering"],
    ["Site Reliability Engineer", "engineering"],
    ["Data Analyst", "data"],
    ["Product Manager", "product"],
    ["Senior Accountant", "finance"],
    ["Corporate Counsel", "legal"],
    ["Starbucks Barista", "operations"],
    ["Talent Acquisition Partner", "people"],
    ["UX Designer", "design"],
  ])("places %j in %s", (title, family) => {
    expect(classifyTitle(title).family).toBe(family);
  });

  // These all contain "engineer" and none are software engineering roles.
  it.each([
    ["Engineering Operation Technician", "trades"],
    ["Installation Technician", "trades"],
    ["Sales Engineer", "sales"],
    ["Technical Support Engineer", "support"],
  ])("does not mistake %j for engineering", (title, family) => {
    expect(classifyTitle(title).family).toBe(family);
  });

  it("reports a genuinely ambiguous title rather than guessing", () => {
    expect(classifyTitle("Solutions Architect").family).toBe("ambiguous");
    expect(classifyTitle("Technical Consultant").family).toBe("ambiguous");
  });

  it("explains what decided the classification", () => {
    expect(classifyTitle("Senior Accountant").evidence).toMatch(/accountant/i);
  });
});

describe("familyVerdict", () => {
  const wanted = { wanted: ["engineering"] as const };

  it("keeps a wanted discipline and rejects an unwanted one with a reason", () => {
    expect(familyVerdict("Senior Software Engineer", { wanted: ["engineering"] }).keep).toBe(true);

    const rejected = familyVerdict("Senior Financial Analyst", { wanted: ["engineering"] });
    expect(rejected.keep).toBe(false);
    expect(rejected.reason).toMatch(/finance/);
  });

  it("keeps ambiguous titles by default and flags them for review", () => {
    const verdict = familyVerdict("Solutions Architect", { wanted: ["engineering"] });

    // A description fetch is cheaper than silently dropping the right job.
    expect(verdict.keep).toBe(true);
    expect(verdict.needsReview).toBe(true);
  });

  it("can be told to discard ambiguous titles instead", () => {
    const verdict = familyVerdict("Solutions Architect", {
      wanted: ["engineering"],
      keepAmbiguous: false,
    });
    expect(verdict.keep).toBe(false);
  });

  it("never marks a confidently placed title as needing review", () => {
    expect(familyVerdict("Senior Accountant", wanted).needsReview).toBe(false);
    expect(familyVerdict("Software Engineer", wanted).needsReview).toBe(false);
  });
});

describe("calibration considers every posting of a saved role", () => {
  // A saved Okta role had 19 postings; the first was in Toronto and the matcher
  // rejected it, but twelve were in the candidate's city and passed. Judging on
  // the first match alone reported a working matcher as 0% recall.
  it("keeps a saved role when any of its postings survives", () => {
    const saved = parseSavedJobs([
      { "Job Title": "Senior Software Engineer", "Company Name": "Okta" },
    ]);
    const scanned = [
      job({ id: "1", title: "Senior Software Engineer", company_name: "Okta", locations: ["Toronto, Canada"] }),
      job({ id: "2", title: "Senior Software Engineer", company_name: "Okta", locations: ["Bengaluru, India"] }),
    ];

    const result = calibrate(saved, scanned, (j) =>
      j.locations.some((l) => l.includes("Bengaluru")) ? null : "tier0:location"
    );

    expect(result.found).toBe(1);
    expect(result.kept).toBe(1);
    expect(result.missed).toEqual([]);
  });

  it("reports the dominant reason when every posting is rejected", () => {
    const saved = parseSavedJobs([{ "Job Title": "Engineer", "Company Name": "Acme" }]);
    const scanned = [
      job({ id: "1", title: "Engineer", company_name: "Acme", locations: ["Oslo"] }),
      job({ id: "2", title: "Engineer", company_name: "Acme", locations: ["Lima"] }),
      job({ id: "3", title: "Engineer", company_name: "Acme", locations: ["Perth"] }),
    ];

    const result = calibrate(saved, scanned, (j) =>
      j.locations[0] === "Perth" ? "tier0:seniority" : "tier0:location"
    );

    expect(result.kept).toBe(0);
    expect(result.missed[0].rejectedBy).toBe("tier0:location");
  });
});

describe("location naming in the wild", () => {
  // Found by calibration: a saved Epicor role in "India, Bangalore" was
  // rejected against a stated preference of "Bengaluru" — the same city.
  it("treats a city's alternate names as the same place", () => {
    const bangalore = job({ id: "1", title: "X", locations: ["India, Bangalore"] });
    expect(locationCompatible(bangalore, { ...preferences, locations: ["Bengaluru"] })).toBe(true);

    const bombay = job({ id: "2", title: "X", locations: ["Bombay, India"] });
    expect(locationCompatible(bombay, { ...preferences, locations: ["Mumbai"] })).toBe(true);
  });

  it("works in the other direction too", () => {
    const bengaluru = job({ id: "1", title: "X", locations: ["Bengaluru, India"] });
    expect(locationCompatible(bengaluru, { ...preferences, locations: ["Bangalore"] })).toBe(true);
  });

  // Workday returns "4 Locations" instead of naming them.
  it("treats a location count as unknown rather than as a failed match", () => {
    const counted = job({ id: "1", title: "X", locations: ["4 Locations"] });
    expect(locationCompatible(counted, preferences)).toBe(true);
  });

  it("still rejects a genuinely different city", () => {
    const oslo = job({ id: "1", title: "X", locations: ["Oslo, Norway"] });
    expect(locationCompatible(oslo, { ...preferences, locations: ["Bengaluru"] })).toBe(false);
  });
});

describe("isSameRole direction", () => {
  // A scanned "Product Developer" matched a saved "Lead Product Developer -
  // Angular JS", and because that unrelated role was in the wrong city the
  // harness blamed the matcher for a rejection it had not made.
  it("does not match a broader scanned title to a more specific saved one", () => {
    expect(isSameRole("Lead Product Developer - Angular JS", "Product Developer")).toBe(false);
    expect(isSameRole("Senior Software Engineer, Payments", "Software Engineer")).toBe(false);
  });

  it("still tolerates suffixes the board adds to the saved title", () => {
    expect(isSameRole("Software Engineer", "Software Engineer II - Payments (Remote)")).toBe(true);
  });
});
