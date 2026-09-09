import { describe, expect, it } from "vitest";
import { explainScore, scoreDescription } from "../src/network-scan/matching/keywords.js";
import { rankJobs, UNCONFIRMED_DISCIPLINE_FACTOR } from "../src/network-scan/matching/rank.js";
import { runMatching } from "../src/network-scan/matching/pipeline.js";
import { workdayDetailUrl, needsDescription } from "../src/network-scan/matching/enrich.js";
import {
  applyAnswers,
  buildDisciplineBatches,
  buildFitBatches,
  normalizeFitScore,
} from "../src/network-scan/matching/review.js";
import { buildSkills } from "../src/network-scan/import/signals.js";
import type { CandidateSkills, Company, Job, NetworkImport } from "../src/network-scan/schema.js";

const skills: CandidateSkills = {
  listed: ["Java", "React.js", "System design", "Go"],
  held_titles: ["Senior Software Engineer"],
  experience_terms: ["angular", "components"],
};

function job(over: Partial<Job> & { id: string; title: string }): Job {
  return {
    company_id: "acme",
    company_name: "Acme",
    locations: ["Bengaluru"],
    source: { provider: "greenhouse", fetched_at: "2026-09-09T00:00:00.000Z" },
    matches_preferences: false,
    matched_on: [],
    ...over,
  };
}

describe("scoreDescription", () => {
  it("matches whole terms, not fragments", () => {
    // "Java" must not be found inside "JavaScript", nor "Go" inside "Google".
    const result = scoreDescription("We use JavaScript at Google.", skills);
    expect(result.matched.map((m) => m.term)).not.toContain("Java");
    expect(result.matched.map((m) => m.term)).not.toContain("Go");
  });

  it("finds a term when it genuinely appears", () => {
    const result = scoreDescription("Strong Java and React.js experience required.", skills);
    const terms = result.matched.map((m) => m.term);
    expect(terms).toContain("Java");
    expect(terms).toContain("React.js");
  });

  it("matches multi-word skills as a phrase", () => {
    expect(scoreDescription("You will own system design.", skills).matched.map((m) => m.term))
      .toContain("System design");
    expect(scoreDescription("A system for design review.", skills).matched.map((m) => m.term))
      .not.toContain("System design");
  });

  it("handles skills whose punctuation carries meaning", () => {
    const punctuated: CandidateSkills = {
      listed: ["C++", "C#", ".NET", "Node.js"],
      held_titles: [],
      experience_terms: [],
    };
    const terms = scoreDescription("Experience with C++, C# and Node.js.", punctuated)
      .matched.map((m) => m.term);

    expect(terms).toEqual(expect.arrayContaining(["C++", "C#", "Node.js"]));
    expect(terms).not.toContain(".NET");
  });

  it("weights a listed skill above a term from history", () => {
    const listedOnly = scoreDescription("Java.", skills).score;
    const termOnly = scoreDescription("components.", skills).score;
    expect(listedOnly).toBeGreaterThan(termOnly);
  });

  it("scores an empty description at zero without throwing", () => {
    expect(scoreDescription("", skills).score).toBe(0);
  });

  it("reports which listed skills the posting never mentions", () => {
    expect(scoreDescription("Java only.", skills).missing).toContain("React.js");
  });

  it("explains itself in the candidate's own words", () => {
    expect(explainScore(scoreDescription("Java and React.js.", skills))).toMatch(/Java/);
    expect(explainScore(scoreDescription("Nothing relevant.", skills))).toMatch(/no overlap/);
  });
});

describe("rankJobs", () => {
  const companies = [
    {
      id: "big",
      canonical_name: "Big",
      aliases: [],
      connections: [],
      signals: {
        connection_count: 20,
        seniority: { leadership: 3, lead: 3, senior: 3, mid: 3, junior: 0, unknown: 0 },
        saved_job_count: 2,
        followed: true,
        ex_employer: true,
        alumni: false,
      },
    },
    {
      id: "small",
      canonical_name: "Small",
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
    },
  ] as Company[];

  const score = (n: number) => ({ score: n, matched: [], missing: [] });

  it("rescales fit against the best in the set before combining", () => {
    // Raw keyword scores sit in a narrow band near zero; without rescaling,
    // referral leverage decides the whole ordering.
    const ranked = rankJobs(
      [
        { job: job({ id: "a", title: "Engineer", company_id: "small" }), keywords: score(0.25) },
        { job: job({ id: "b", title: "Engineer", company_id: "big" }), keywords: score(0.05) },
      ],
      companies,
      { referralWeight: 0.4 }
    );

    expect(ranked[0].job.id).toBe("a");
    expect(ranked[0].relativeMatch).toBe(1);
  });

  it("lets referral access break a tie on fit", () => {
    const ranked = rankJobs(
      [
        { job: job({ id: "a", title: "Engineer", company_id: "small" }), keywords: score(0.2) },
        { job: job({ id: "b", title: "Engineer", company_id: "big" }), keywords: score(0.2) },
      ],
      companies,
      { referralWeight: 0.4 }
    );
    expect(ranked[0].job.company_id).toBe("big");
  });

  it("holds back a job whose discipline was never established", () => {
    const ranked = rankJobs(
      [
        { job: job({ id: "a", title: "Business Analyst" }), keywords: score(0.2), disciplineConfirmed: false },
        { job: job({ id: "b", title: "Software Engineer" }), keywords: score(0.2), disciplineConfirmed: true },
      ],
      companies,
      { referralWeight: 0 }
    );

    expect(ranked[0].job.id).toBe("b");
    expect(ranked[1].rank).toBeCloseTo(ranked[0].rank * UNCONFIRMED_DISCIPLINE_FACTOR, 3);
  });

  it("can ignore referrals entirely", () => {
    const ranked = rankJobs(
      [
        { job: job({ id: "a", title: "Engineer", company_id: "small" }), keywords: score(0.3) },
        { job: job({ id: "b", title: "Engineer", company_id: "big" }), keywords: score(0.1) },
      ],
      companies,
      { referralWeight: 0 }
    );
    expect(ranked[0].job.id).toBe("a");
  });

  it("orders identically across runs", () => {
    const input = [
      { job: job({ id: "a", title: "Engineer" }), keywords: score(0.2) },
      { job: job({ id: "b", title: "Engineer" }), keywords: score(0.2) },
    ];
    expect(rankJobs(input, companies).map((r) => r.job.id)).toEqual(
      rankJobs([...input].reverse(), companies).map((r) => r.job.id)
    );
  });
});

describe("runMatching", () => {
  const network = {
    source: "export",
    imported_at: "2026-09-09T00:00:00.000Z",
    counts: {
      connection_rows: 0, connections_with_company: 0, companies: 0,
      dropped_non_employer: 0, dropped_blank_company: 0, saved_jobs: 0, followed_orgs: 0,
    },
    preferences: { titles: [], locations: ["Bengaluru"], job_types: [], industries: [] },
    skills,
    companies: [],
    review: [],
    missing_files: [],
  } as unknown as NetworkImport;

  it("reports every stage, including what each one dropped and why", () => {
    const jobs = [
      job({ id: "1", title: "Senior Software Engineer" }),
      job({ id: "2", title: "Senior Accountant" }),
      job({ id: "3", title: "Software Engineer Intern" }),
      job({ id: "4", title: "Senior Software Engineer" }),
    ];

    const result = runMatching(jobs, network, new Map(), {
      wantedFamilies: ["engineering"],
      minLevel: "mid",
    });

    const stages = result.funnel.map((s) => s.stage);
    expect(stages).toEqual([
      "collapse duplicate postings",
      "structural",
      "discipline",
      "keyword score",
    ]);
    expect(result.funnel[0].reasons["same role, another location"]).toBe(1);
    expect(result.funnel[1].reasons.seniority).toBe(1);
    expect(result.funnel[2].reasons.finance).toBe(1);
  });

  it("never drops an unscored job for a low score it could not earn", () => {
    const result = runMatching([job({ id: "1", title: "Software Engineer" })], network, new Map(), {
      wantedFamilies: ["engineering"],
      minScore: 0.5,
    });

    expect(result.ranked).toHaveLength(1);
    expect(result.needsDescription).toHaveLength(1);
  });

  it("does drop a scored job that falls below the threshold", () => {
    const result = runMatching(
      [job({ id: "1", title: "Software Engineer" })],
      network,
      new Map([["1", "Nothing relevant here at all."]]),
      { wantedFamilies: ["engineering"], minScore: 0.5 }
    );
    expect(result.ranked).toHaveLength(0);
  });
});

describe("enrich", () => {
  it("derives the Workday detail endpoint from a careers URL", () => {
    expect(
      workdayDetailUrl("https://nvidia.wd5.myworkdayjobs.com/Site/job/Bengaluru/Engineer_JR123")
    ).toBe("https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/Site/job/Bengaluru/Engineer_JR123");
  });

  it("returns null for a URL that is not Workday", () => {
    expect(workdayDetailUrl("https://boards.greenhouse.io/acme/jobs/1")).toBeNull();
  });

  it("only asks for descriptions that are actually missing and fetchable", () => {
    const workdayJob = job({
      id: "1",
      title: "Engineer",
      job_url: "https://x.wd5.myworkdayjobs.com/S/job/a",
      source: { provider: "workday", fetched_at: "2026-09-09T00:00:00.000Z" },
    });

    expect(needsDescription(workdayJob, new Map())).toBe(true);
    expect(needsDescription(workdayJob, new Map([["1", "text"]]))).toBe(false);
    // Greenhouse already returns its text in the list response.
    expect(needsDescription(job({ id: "2", title: "E", job_url: "https://x" }), new Map())).toBe(false);
  });
});

describe("review batches", () => {
  const jobs = Array.from({ length: 95 }, (_, i) => job({ id: `j${i}`, title: `Analyst ${i}` }));

  it("splits discipline questions into batches and asks about every job once", () => {
    const batches = buildDisciplineBatches(jobs, 40);
    const asked = batches.flatMap((b) => b.items.map((i) => i.job_id));

    expect(batches).toHaveLength(3);
    expect(new Set(asked).size).toBe(jobs.length);
    // Titles alone — sending descriptions here would waste the expensive pass.
    expect(batches[0].items[0].description).toBeUndefined();
  });

  it("sizes fit batches by text volume, not item count", () => {
    const ranked = jobs.slice(0, 10).map((j) => ({
      job: j, matchScore: 0.5, relativeMatch: 1, referralScore: 0, rank: 0.5,
      matchedTerms: [], disciplineConfirmed: true,
    }));
    const descriptions = new Map(ranked.map((r) => [r.job.id, "x".repeat(5_000)]));

    const batches = buildFitBatches(ranked, descriptions, skills, { charBudget: 12_000 });
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(batch.items.reduce((n, i) => n + (i.description?.length ?? 0), 0)).toBeLessThanOrEqual(15_000);
    }
  });

  it("skips jobs with no description rather than sending an empty prompt", () => {
    const ranked = [{
      job: jobs[0], matchScore: 0, relativeMatch: 0, referralScore: 0, rank: 0,
      matchedTerms: [], disciplineConfirmed: true,
    }];
    expect(buildFitBatches(ranked, new Map(), skills)).toEqual([]);
  });
});

describe("applyAnswers", () => {
  const batches = buildDisciplineBatches([
    job({ id: "a", title: "Analyst" }),
    job({ id: "b", title: "Specialist" }),
  ]);

  it("reports items the model failed to answer", () => {
    const applied = applyAnswers(batches, [{ job_id: "a", verdict: "yes" as const }]);
    expect(applied.unanswered).toEqual(["b"]);
  });

  it("refuses answers for ids it never asked about", () => {
    const applied = applyAnswers(batches, [
      { job_id: "a", verdict: "yes" as const },
      { job_id: "invented", verdict: "yes" as const },
    ]);

    expect(applied.unexpected).toEqual(["invented"]);
    expect(applied.answers.has("invented")).toBe(false);
  });
});

describe("normalizeFitScore", () => {
  it.each([
    [0.5, 0.5],
    [1.4, 1],
    [-2, 0],
    ["0.75", 0.75],
  ])("clamps %j to %j", (input, expected) => {
    expect(normalizeFitScore(input)).toBe(expected);
  });

  it("rejects a non-numeric score rather than treating it as zero", () => {
    expect(normalizeFitScore("very good")).toBeNull();
    expect(normalizeFitScore(undefined)).toBeNull();
  });
});

describe("buildSkills", () => {
  it("takes the candidate's own words and keeps recurring experience terms", () => {
    const result = buildSkills({
      skills: [{ Name: "React.js" }, { Name: "Java" }, { Name: "" }],
      positions: [
        { Title: "Senior Software Engineer", Description: "Built Angular components and Angular apps." },
        { Title: "Software Engineer", Description: "Angular work." },
      ],
    });

    expect(result.listed).toEqual(["Java", "React.js"]);
    expect(result.held_titles).toEqual(["Senior Software Engineer", "Software Engineer"]);
    // "angular" recurs; a word used once does not become part of the profile.
    expect(result.experience_terms).toContain("angular");
    expect(result.experience_terms).not.toContain("apps");
  });

  it("returns empty structures when the export has neither file", () => {
    expect(buildSkills({})).toEqual({ listed: [], held_titles: [], experience_terms: [] });
  });
});

describe("funnel composition, not just its parts", () => {
  const network = {
    source: "export",
    imported_at: "2026-09-09T00:00:00.000Z",
    counts: {
      connection_rows: 0, connections_with_company: 0, companies: 0,
      dropped_non_employer: 0, dropped_blank_company: 0, saved_jobs: 0, followed_orgs: 0,
    },
    preferences: { titles: [], locations: ["Bengaluru"], job_types: [], industries: [] },
    skills,
    companies: [],
    review: [],
    missing_files: [],
  } as unknown as NetworkImport;

  // The bug: collapse kept one posting's city, so a role open in Toronto and
  // Bengaluru was judged Toronto-only and dropped. Every part passed its own
  // test; only running them together caught it.
  it("keeps a multi-city role that is open where the candidate wants", () => {
    const result = runMatching(
      [
        job({ id: "gh:1", title: "Senior Software Engineer", locations: ["Toronto, Canada"] }),
        job({ id: "gh:2", title: "Senior Software Engineer", locations: ["Bengaluru, India"] }),
      ],
      network,
      new Map(),
      { wantedFamilies: ["engineering"] }
    );

    expect(result.ranked).toHaveLength(1);
  });

  it("reports the surviving postings, not just the merged row", async () => {
    const { survivingJobIds } = await import("../src/network-scan/matching/pipeline.js");
    const survivors = survivingJobIds(
      [
        job({ id: "gh:1", title: "Senior Software Engineer", locations: ["Toronto, Canada"] }),
        job({ id: "gh:2", title: "Senior Software Engineer", locations: ["Bengaluru, India"] }),
      ],
      network,
      new Map(),
      { wantedFamilies: ["engineering"] }
    );

    // Both postings survived; calibration must not think gh:2 was dropped.
    expect(survivors.has("gh:1")).toBe(true);
    expect(survivors.has("gh:2")).toBe(true);
  });

  it("prioritises enrichment by confidence then leverage, not by id", () => {
    const withCompanies = {
      ...network,
      companies: [
        { id: "big", canonical_name: "Big", aliases: [], connections: [], signals: { connection_count: 10, seniority: { leadership: 2, lead: 2, senior: 2, mid: 2, junior: 0, unknown: 0 }, saved_job_count: 1, followed: true, ex_employer: false, alumni: false } },
        { id: "small", canonical_name: "Small", aliases: [], connections: [], signals: { connection_count: 1, seniority: { leadership: 0, lead: 0, senior: 0, mid: 1, junior: 0, unknown: 0 }, saved_job_count: 0, followed: false, ex_employer: false, alumni: false } },
      ],
    } as unknown as NetworkImport;

    const result = runMatching(
      [
        job({ id: "aaa", title: "Solutions Architect", company_id: "small", locations: ["Bengaluru"] }),
        job({ id: "zzz", title: "Senior Software Engineer", company_id: "big", locations: ["Bengaluru"] }),
      ],
      withCompanies,
      new Map(),
      { wantedFamilies: ["engineering"] }
    );

    // "zzz" sorts last by id but is a confirmed engineering role at the better
    // connected company, so it is the description worth buying first.
    expect(result.needsDescription[0].id).toBe("zzz");
  });
});

describe("structural input validation", () => {
  it("refuses an unrecognised level instead of rejecting every job", async () => {
    const { structuralVerdict } = await import("../src/network-scan/matching/structural.js");
    expect(() =>
      structuralVerdict(job({ id: "1", title: "Engineer" }), {
        preferences: { titles: [], locations: [], job_types: [], industries: [] },
        maxLevel: "staff" as never,
      })
    ).toThrow(/not a level/);
  });
});
