import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSlug,
  createOpportunity,
  extractCompanyAndTitle,
  extractJobId,
  extractPostingDate,
  normalizeDate,
  slugify,
} from "../../src/resume/opportunity.js";

const fixturesDir = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");
const masterResumePath = join(fixturesDir, "resume.yml");
const labeledJdPath = join(fixturesDir, "jd-labeled.md");
const headingJdPath = join(fixturesDir, "jd-heading.md");
const ambiguousJdPath = join(fixturesDir, "jd-ambiguous.md");
const jobIdJdPath = join(fixturesDir, "jd-jobid.md");
const postedDateJdPath = join(fixturesDir, "jd-posted-date.md");

describe("slugify", () => {
  it("lowercases, hyphenates, and trims", () => {
    expect(slugify("Stripe Senior Software Engineer")).toBe("stripe-senior-software-engineer");
  });

  it("collapses repeated separators and strips unsafe characters", () => {
    expect(slugify("Stripe / Senior   Engineer!!")).toBe("stripe-senior-engineer");
  });

  it("is deterministic for the same input", () => {
    expect(slugify("Acme Corp")).toBe(slugify("Acme Corp"));
  });
});

describe("extractCompanyAndTitle", () => {
  it("reads labeled Company/Title lines", () => {
    expect(extractCompanyAndTitle("Company: Stripe\nTitle: Senior Software Engineer\n")).toEqual({
      company: "Stripe",
      title: "Senior Software Engineer",
    });
  });

  it("falls back to a heading split on ' at '", () => {
    expect(extractCompanyAndTitle("# Senior Software Engineer at Stripe\n\nDetails...")).toEqual({
      company: "Stripe",
      title: "Senior Software Engineer",
    });
  });

  it("throws when neither heuristic yields both fields", () => {
    expect(() => extractCompanyAndTitle("We're hiring across several teams.")).toThrow();
  });
});

describe("extractJobId", () => {
  it("reads a labeled Job ID line", () => {
    expect(extractJobId("Job ID: REQ-2024-8891\n")).toBe("REQ-2024-8891");
  });

  it("recognizes Req ID / Requisition ID / Posting ID / Reference labels", () => {
    expect(extractJobId("Req ID: 1234")).toBe("1234");
    expect(extractJobId("Requisition ID: 1234")).toBe("1234");
    expect(extractJobId("Posting ID: 1234")).toBe("1234");
    expect(extractJobId("Reference: 1234")).toBe("1234");
  });

  it("returns undefined when no job ID line is present", () => {
    expect(extractJobId("We're hiring across several teams.")).toBeUndefined();
  });
});

describe("normalizeDate", () => {
  it("passes through ISO dates", () => {
    expect(normalizeDate("2026-03-04")).toBe("2026-03-04");
  });

  it("normalizes 'Month D, YYYY'", () => {
    expect(normalizeDate("March 4, 2026")).toBe("2026-03-04");
  });

  it("normalizes 'D Month YYYY'", () => {
    expect(normalizeDate("4 March 2026")).toBe("2026-03-04");
  });

  it("returns undefined for an unrecognized format rather than guessing", () => {
    expect(normalizeDate("recently")).toBeUndefined();
  });
});

describe("extractPostingDate", () => {
  it("reads a labeled Posted line", () => {
    expect(extractPostingDate("Posted: 2026-03-04")).toBe("2026-03-04");
  });

  it("returns undefined when the labeled value isn't a recognized date format", () => {
    expect(extractPostingDate("Posted: recently")).toBeUndefined();
  });

  it("returns undefined when no posting-date line is present", () => {
    expect(extractPostingDate("We're hiring across several teams.")).toBeUndefined();
  });
});

describe("buildSlug", () => {
  it("uses company+title alone as the final fallback", () => {
    expect(buildSlug("Stripe", "Senior Software Engineer")).toBe("stripe-senior-software-engineer");
  });

  it("appends the posting date when no job ID is available", () => {
    expect(buildSlug("Stripe", "Senior Software Engineer", undefined, "2026-03-04")).toBe(
      "stripe-senior-software-engineer-2026-03-04"
    );
  });

  it("prefers the job ID over the posting date when both are available", () => {
    expect(buildSlug("Stripe", "Senior Software Engineer", "REQ-2024-8891", "2026-03-04")).toBe(
      "stripe-senior-software-engineer-req-2024-8891"
    );
  });
});

describe("createOpportunity", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loom-opportunities-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates artifacts/jd.md and artifacts/resume.yml under a deterministic slug", async () => {
    const result = await createOpportunity({
      masterResumePath,
      jdPath: labeledJdPath,
      opportunitiesRoot: root,
    });

    expect(result.slug).toBe("stripe-senior-software-engineer");
    expect(result.company).toBe("Stripe");
    expect(result.title).toBe("Senior Software Engineer");

    const jd = await readFile(join(result.artifactsDir, "jd.md"), "utf8");
    const resume = await readFile(join(result.artifactsDir, "resume.yml"), "utf8");
    expect(jd).toContain("Company: Stripe");
    expect(resume).toContain("Alex Example");
  });

  it("determines company/title from a heading when no labels are present", async () => {
    const result = await createOpportunity({
      masterResumePath,
      jdPath: headingJdPath,
      opportunitiesRoot: root,
    });
    expect(result.slug).toBe("stripe-senior-software-engineer");
  });

  it("appends a job ID from the JD to disambiguate the slug", async () => {
    const result = await createOpportunity({ masterResumePath, jdPath: jobIdJdPath, opportunitiesRoot: root });
    expect(result.slug).toBe("stripe-senior-software-engineer-req-2024-8891");
    expect(result.jobId).toBe("REQ-2024-8891");
  });

  it("falls back to the posting date when no job ID is present", async () => {
    const result = await createOpportunity({ masterResumePath, jdPath: postedDateJdPath, opportunitiesRoot: root });
    expect(result.slug).toBe("stripe-senior-software-engineer-2026-03-04");
    expect(result.postedDate).toBe("2026-03-04");
  });

  it("uses an explicit --job-id override instead of parsing the JD", async () => {
    const result = await createOpportunity({
      masterResumePath,
      jdPath: labeledJdPath,
      opportunitiesRoot: root,
      jobId: "CUSTOM-1",
    });
    expect(result.slug).toBe("stripe-senior-software-engineer-custom-1");
  });

  it("uses explicit --company/--role overrides instead of parsing the JD", async () => {
    const result = await createOpportunity({
      masterResumePath,
      jdPath: ambiguousJdPath,
      opportunitiesRoot: root,
      company: "Acme",
      role: "Staff Engineer",
    });
    expect(result.slug).toBe("acme-staff-engineer");
  });

  it("fails with a useful error when company/title can't be determined and no override is given", async () => {
    await expect(
      createOpportunity({ masterResumePath, jdPath: ambiguousJdPath, opportunitiesRoot: root })
    ).rejects.toThrow(/could not determine/i);
  });

  it("fails when the master resume input is missing", async () => {
    await expect(
      createOpportunity({
        masterResumePath: join(fixturesDir, "does-not-exist.yml"),
        jdPath: labeledJdPath,
        opportunitiesRoot: root,
      })
    ).rejects.toThrow();
  });

  it("does not silently overwrite an existing opportunity directory", async () => {
    await createOpportunity({ masterResumePath, jdPath: labeledJdPath, opportunitiesRoot: root });
    await expect(
      createOpportunity({ masterResumePath, jdPath: labeledJdPath, opportunitiesRoot: root })
    ).rejects.toThrow(/already exists/i);
  });
});
