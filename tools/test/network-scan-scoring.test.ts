import { describe, expect, it } from "vitest";
import {
  buildDemandWeights,
  explainScore,
  requirementShapedTerms,
  rescaleForBatch,
  scoreDescription,
} from "../src/network-scan/matching/keywords.js";
import { titleAffinity } from "../src/network-scan/matching/title-affinity.js";
import { rankJobs, recentHeldTitles, UNCONFIRMED_DISCIPLINE_FACTOR } from "../src/network-scan/matching/rank.js";
import { runMatching } from "../src/network-scan/matching/pipeline.js";
import { workdayDetailUrl, needsDescription } from "../src/network-scan/matching/enrich.js";
import { checkPreferenceStaleness } from "../src/network-scan/matching/staleness.js";
import {
  applyAnswers,
  buildDisciplineBatches,
  buildFitBatches,
  normalizeFitScore,
} from "../src/network-scan/matching/review.js";
import { buildSkills } from "../src/network-scan/import/signals.js";
import type {
  CandidatePreferences,
  CandidateSkills,
  Career,
  Company,
  Job,
  NetworkImport,
} from "../src/network-scan/schema.js";

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

  it("scores a focused JD higher than a long one that buries the same skills in noise", () => {
    // The bug this replaces: dividing by the candidate's whole vocabulary
    // made a job that fits perfectly score low just for being short, while a
    // long QA-automation posting that happened to name many technologies
    // scored highest in a real 200-job run.
    const focused = "Java, React.js and Go required.";
    const buriedIn200Requirements =
      "Java React.js System design Go " +
      Array.from({ length: 200 }, (_, i) => `requirement${i}`).join(" ");

    expect(scoreDescription(focused, skills).score).toBeGreaterThan(
      scoreDescription(buriedIn200Requirements, skills).score
    );
  });

  it("does not let either coverage direction alone carry the score", () => {
    // Naming everything the candidate has, diluted across hundreds of
    // unrelated requirements, should not outscore a tightly focused posting —
    // skillCoverage alone would say otherwise.
    const long = scoreDescription(
      "Java React.js System design Go " +
        Array.from({ length: 200 }, (_, i) => `requirement${i}`).join(" "),
      skills
    );
    expect(long.skillCoverage).toBe(1);
    expect(long.score).toBeLessThan(long.skillCoverage);
  });

  it("computes skill coverage as a fraction of the candidate's listed skills", () => {
    const result = scoreDescription("Java and Go, nothing else.", skills);
    expect(result.skillCoverage).toBeCloseTo(2 / skills.listed.length, 4);
  });

  it("does not crash for a candidate with no listed skills", () => {
    const bare: CandidateSkills = { listed: [], held_titles: [], experience_terms: [] };
    expect(() => scoreDescription("Java and React.js.", bare)).not.toThrow();
    expect(scoreDescription("Java and React.js.", bare).skillCoverage).toBe(0);
  });

  it("scores an empty description at zero on every axis", () => {
    const result = scoreDescription("", skills);
    expect(result.score).toBe(0);
    expect(result.demandCoverage).toBe(0);
  });
});

describe("requirementShapedTerms", () => {
  it("keeps a technology name shaped by its own punctuation", () => {
    const terms = requirementShapedTerms("Experience with Node.js, C++, C# and S3 required.");
    expect(terms).toEqual(expect.arrayContaining(["node.js", "c++", "c#", "s3"]));
  });

  it("keeps a technology name capitalized in the middle of a sentence", () => {
    expect(requirementShapedTerms("hands-on experience with EKS / Kubernetes is preferred"))
      .toContain("kubernetes");
  });

  it("drops an ordinary word capitalized only because it opens a sentence", () => {
    expect(requirementShapedTerms("We are looking for a great engineer. Design is key."))
      .not.toEqual(expect.arrayContaining(["design"]));
  });

  it("drops an ordinary word capitalized only because it opens a bullet", () => {
    // Boards render requirements as a bare "- Design and build..." with no
    // real list markup; every one of those leads with an action verb
    // capitalized purely because it opens the bullet.
    const terms = requirementShapedTerms(
      "Key responsibilities - Design and build APIs - Own the release process - Mentor engineers"
    );
    expect(terms).not.toEqual(expect.arrayContaining(["design", "own", "mentor"]));
  });

  it("keeps a capitalized name at the very start of the text", () => {
    // The opposite failure mode: excluding the very first word of a
    // description just because there is nothing before it to check.
    expect(requirementShapedTerms("Kubernetes experience is required for this role."))
      .toContain("kubernetes");
  });

  it("does not treat a trailing sentence period as part of the word's shape", () => {
    // Without trimming it first, every ordinary last word of a sentence
    // reads as punctuation-shaped just because a period follows it.
    expect(requirementShapedTerms("We need someone great at components.")).not.toContain("components");
  });
});

describe("buildDemandWeights and rescaleForBatch", () => {
  it("weights a term that appears in every posting down to nearly nothing", () => {
    // "Equal" is capitalized mid-sentence in every posting's boilerplate
    // footer, so it passes the shape filter same as a real technology name
    // would — it is document frequency, not shape, that has to tell them
    // apart here.
    const corpus = [
      "We need someone strong in Kubernetes. We follow an Equal opportunity policy.",
      "We need someone strong in React.js. We follow an Equal opportunity policy.",
      "We need someone strong in Python. We follow an Equal opportunity policy.",
    ];
    const weights = buildDemandWeights(corpus);
    expect(weights.get("equal")!).toBeLessThan(weights.get("kubernetes")!);
  });

  it("clips the batch's strongest fractions to 1, not to their raw value", () => {
    const scores = [
      { score: 0, skillCoverage: 0.3, demandCoverage: 0.2, matched: [], missing: [] },
      { score: 0, skillCoverage: 0.1, demandCoverage: 0.05, matched: [], missing: [] },
    ];
    const rescaled = rescaleForBatch(scores);
    // The strongest job in the batch on both axes should read near the top
    // of the range, not at its own small literal fraction.
    expect(rescaled[0].score).toBeGreaterThan(0.8);
    expect(rescaled[1].score).toBeLessThan(rescaled[0].score);
  });

  it("leaves every score at zero when nothing in the batch scored above zero", () => {
    const scores = [
      { score: 0, skillCoverage: 0, demandCoverage: 0, matched: [], missing: [] },
    ];
    expect(rescaleForBatch(scores)[0].score).toBe(0);
  });

  it("does not change what skillCoverage or demandCoverage themselves mean", () => {
    const scores = [{ score: 0, skillCoverage: 0.25, demandCoverage: 0.1, matched: [], missing: [] }];
    const rescaled = rescaleForBatch(scores);
    expect(rescaled[0].skillCoverage).toBe(0.25);
    expect(rescaled[0].demandCoverage).toBe(0.1);
  });
});

describe("titleAffinity", () => {
  const preferredTitles = [
    "Full Stack Engineer",
    "Javascript Developer",
    "Web Developer",
    "Frontend Developer",
    "Software Engineer",
  ];

  it("scores a role matching a stated title above one that does not", () => {
    const fullStack = titleAffinity("Full Stack Engineer", preferredTitles);
    const qa = titleAffinity("Agile Test Automation Engineer, Quality Assurance", preferredTitles);
    expect(fullStack).toBeGreaterThan(qa);
  });

  it("gives partial credit for a compound title spelled differently", () => {
    // "Fullstack" (concatenated) against "Full Stack" (spaced) is the same
    // word split two different ways — the board's choice of spelling should
    // not zero out the match.
    const score = titleAffinity("Senior Fullstack Engineer", ["Full Stack Engineer"]);
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });

  it("does not let a generic word like 'Engineer' alone carry a match", () => {
    // A QA role and a full-stack role share nothing but the word "Engineer".
    const score = titleAffinity("Quality Assurance Test Engineer", ["Full Stack Engineer"]);
    expect(score).toBeLessThan(0.3);
  });

  it("scores an exact title match at 1", () => {
    expect(titleAffinity("Software Engineer", preferredTitles)).toBe(1);
  });

  it("returns a neutral zero when the candidate stated no target titles", () => {
    // rankJobs is what turns this into "no penalty" — it only applies title
    // affinity's weight when the candidate actually listed titles.
    expect(titleAffinity("Corporate Counsel", [])).toBe(0);
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

  const score = (n: number) => ({ score: n, skillCoverage: n, demandCoverage: n, matched: [], missing: [] });

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

  it("lets a job matching the candidate's stated titles outrank one with similar fit that does not", () => {
    // The real bug: a QA-automation posting scored highest on keyword fit
    // alone for a candidate who never listed QA among their target titles.
    const ranked = rankJobs(
      [
        {
          job: job({ id: "qa", title: "Agile Test Automation Engineer, Quality Assurance" }),
          keywords: score(0.22),
        },
        { job: job({ id: "fs", title: "Full Stack Engineer" }), keywords: score(0.2) },
      ],
      companies,
      {
        referralWeight: 0,
        preferences: { titles: ["Full Stack Engineer"], locations: [], job_types: [], industries: [] },
      }
    );

    expect(ranked[0].job.id).toBe("fs");
  });

  it("does not let title affinity move anything when the candidate stated no target titles", () => {
    const withoutTitles = rankJobs(
      [
        { job: job({ id: "a", title: "Engineer", company_id: "small" }), keywords: score(0.2) },
        { job: job({ id: "b", title: "Engineer", company_id: "big" }), keywords: score(0.2) },
      ],
      companies,
      { referralWeight: 0.4 }
    );
    expect(withoutTitles[0].job.company_id).toBe("big");
    expect(withoutTitles.every((r) => r.titleAffinity === 0)).toBe(true);
  });

  const seniorCareer: Career = {
    positions: [
      { title: "Senior Software Engineer", started_on: "Apr 2024", is_current: true, level: "senior" },
      { title: "SDE 2", started_on: "Nov 2022", finished_on: "Mar 2024", is_current: false, level: "mid" },
      { title: "Project Intern", started_on: "Jan 2019", finished_on: "Jun 2019", is_current: false, level: "intern" },
    ],
    current_title: "Senior Software Engineer",
    current_level: "senior",
    current_is_inferred: false,
  };

  it("targets recent held titles even when the candidate declared no preferences at all", () => {
    // A candidate whose LinkedIn preferences field was never filled in
    // should still be targeted from their actual career trajectory.
    const ranked = rankJobs(
      [
        { job: job({ id: "match", title: "Senior Software Engineer" }), keywords: score(0.2) },
        { job: job({ id: "unrelated", title: "Corporate Counsel" }), keywords: score(0.2) },
      ],
      companies,
      { referralWeight: 0, career: seniorCareer }
    );

    expect(ranked[0].job.id).toBe("match");
    expect(ranked[0].titleAffinity).toBeGreaterThan(0);
  });

  it("a five-year-stale declared preference does not override recent career history as a target", () => {
    // The real bug this fixes: a five-year-old declared "Web Developer" is
    // still honoured as a target (it is not removed), but the candidate's
    // actual current title now also counts, so a job matching it is not
    // penalised just because the declaration never mentions it.
    const stalePreferences: CandidatePreferences = {
      titles: ["Web Developer"],
      locations: [],
      job_types: [],
      industries: [],
    };

    const ranked = rankJobs(
      [
        { job: job({ id: "current-role", title: "Senior Software Engineer" }), keywords: score(0.2) },
        { job: job({ id: "declared-role", title: "Web Developer" }), keywords: score(0.2) },
      ],
      companies,
      { referralWeight: 0, preferences: stalePreferences, career: seniorCareer }
    );

    // Both are legitimate targets, but a senior candidate's actual current
    // title is at least as strong a target as their stale declaration.
    expect(ranked[0].rank).toBeGreaterThanOrEqual(ranked[1].rank);
  });

  it("outranks an otherwise identical junior-level job for a senior candidate", () => {
    const ranked = rankJobs(
      [
        { job: job({ id: "senior-role", title: "Senior Software Engineer" }), keywords: score(0.2) },
        { job: job({ id: "junior-role", title: "Junior Web Developer" }), keywords: score(0.2) },
      ],
      companies,
      { referralWeight: 0, career: seniorCareer }
    );

    expect(ranked[0].job.id).toBe("senior-role");
    expect(ranked.find((r) => r.job.id === "junior-role")!.levelFit).toBeLessThan(
      ranked.find((r) => r.job.id === "senior-role")!.levelFit
    );
  });

  it("does not punish a stretch role a level above the candidate's current one", () => {
    const ranked = rankJobs(
      [{ job: job({ id: "staff", title: "Staff Software Engineer" }), keywords: score(0.2) }],
      companies,
      { referralWeight: 0, career: seniorCareer }
    );
    expect(ranked[0].levelFit).toBe(1);
  });

  it("does not let level fit move anything when the candidate's current level is unknown", () => {
    const withoutCareer = rankJobs(
      [
        { job: job({ id: "a", title: "Junior Web Developer" }), keywords: score(0.2) },
        { job: job({ id: "b", title: "Senior Software Engineer" }), keywords: score(0.2) },
      ],
      companies,
      { referralWeight: 0 }
    );
    expect(withoutCareer.every((r) => r.levelFit === 1)).toBe(true);
  });
});

describe("recentHeldTitles", () => {
  it("takes the current title and the one before it, not the whole history", () => {
    const career: Career = {
      positions: [
        { title: "Senior Software Engineer", started_on: "Apr 2024", is_current: true, level: "senior" },
        { title: "Software Engineer", started_on: "Jul 2019", finished_on: "Mar 2024", is_current: false, level: "mid" },
        { title: "Project Intern", started_on: "Jan 2019", finished_on: "Jun 2019", is_current: false, level: "intern" },
      ],
      current_title: "Senior Software Engineer",
      current_level: "senior",
      current_is_inferred: false,
    };

    expect(recentHeldTitles(career)).toEqual(["Senior Software Engineer", "Software Engineer"]);
  });

  it("skips a repeated identical title so the second slot names an actually different job", () => {
    const career: Career = {
      positions: [
        { title: "Senior Software Engineer", started_on: "Jan 2025", is_current: true, level: "senior" },
        { title: "Senior Software Engineer", started_on: "Apr 2024", finished_on: "Dec 2024", is_current: false, level: "senior" },
        { title: "Software Engineer", started_on: "Jul 2019", finished_on: "Mar 2024", is_current: false, level: "mid" },
      ],
      current_title: "Senior Software Engineer",
      current_level: "senior",
      current_is_inferred: false,
    };

    expect(recentHeldTitles(career)).toEqual(["Senior Software Engineer", "Software Engineer"]);
  });

  it("returns nothing for a candidate with no career history", () => {
    expect(recentHeldTitles(undefined)).toEqual([]);
    expect(recentHeldTitles({ positions: [], current_is_inferred: false })).toEqual([]);
  });
});

describe("checkPreferenceStaleness", () => {
  const career: Career = {
    positions: [
      { title: "Senior Software Engineer", started_on: "Apr 2024", is_current: true, level: "senior" },
      { title: "SDE 2", started_on: "Nov 2022", finished_on: "Mar 2024", is_current: false, level: "mid" },
    ],
    current_title: "Senior Software Engineer",
    current_level: "senior",
    current_is_inferred: false,
  };

  it("warns when a declared title shares nothing with recent career history", () => {
    const preferences: CandidatePreferences = {
      titles: ["Web Developer"],
      locations: [],
      job_types: [],
      industries: [],
    };

    const warnings = checkPreferenceStaleness(preferences, career);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].declared_title).toBe("Web Developer");
    expect(warnings[0].current_title).toBe("Senior Software Engineer");
    expect(warnings[0].message).toContain("Web Developer");
    expect(warnings[0].message).toContain("Senior Software Engineer");
  });

  it("warns when a declared title's own wording reads well below the current level", () => {
    const preferences: CandidatePreferences = {
      titles: ["Junior Web Developer"],
      locations: [],
      job_types: [],
      industries: [],
    };
    expect(checkPreferenceStaleness(preferences, career)[0].message).toMatch(/levels below/);
  });

  it("does not warn when the declaration agrees with career history", () => {
    const preferences: CandidatePreferences = {
      titles: ["Senior Software Engineer"],
      locations: [],
      job_types: [],
      industries: [],
    };
    expect(checkPreferenceStaleness(preferences, career)).toEqual([]);
  });

  it("has nothing to compare when there are no declared titles or no career history", () => {
    const noTitles: CandidatePreferences = { titles: [], locations: [], job_types: [], industries: [] };
    expect(checkPreferenceStaleness(noTitles, career)).toEqual([]);

    const somePreferences: CandidatePreferences = {
      titles: ["Web Developer"],
      locations: [],
      job_types: [],
      industries: [],
    };
    expect(checkPreferenceStaleness(somePreferences, { positions: [], current_is_inferred: false })).toEqual([]);
  });

  it("never removes or edits the declared preference — it only reports on it", () => {
    const preferences: CandidatePreferences = {
      titles: ["Web Developer"],
      locations: [],
      job_types: [],
      industries: [],
    };
    checkPreferenceStaleness(preferences, career);
    expect(preferences.titles).toEqual(["Web Developer"]);
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

describe("declared preferences are cross-checked against career history", () => {
  // A candidate's LinkedIn preferences had gone five years without an update
  // and still named a tier of role they had long since moved past. Obeyed at
  // full strength, such a title scored a perfect match and ranked a junior-tier
  // job almost level with their current one.
  const career = {
    positions: [
      { title: "Senior Software Engineer", level: "senior", is_current: true },
      { title: "Software Engineer", level: "mid", is_current: false },
    ],
    current_title: "Senior Software Engineer",
    current_level: "senior",
    current_is_inferred: false,
  } as never;

  const preferences = {
    titles: ["Software Engineer", "Web Developer"],
    locations: [],
    job_types: [],
    industries: [],
  };

  const same = { score: 0.2, skillCoverage: 0.2, demandCoverage: 0.1, matched: [], missing: [] };

  it("ranks the candidate's current kind of role above a stale declared one", () => {
    const ranked = rankJobs(
      [
        { job: job({ id: "a", title: "Senior Software Engineer" }), keywords: same },
        { job: job({ id: "b", title: "Web Developer" }), keywords: same },
      ],
      [],
      { preferences, career }
    );

    expect(ranked[0].job.title).toBe("Senior Software Engineer");
    // A clear gap, not a hair's breadth: the whole point is that the stale
    // entry no longer scores as a perfect target.
    expect(ranked[0].rank - ranked[1].rank).toBeGreaterThan(0.1);
  });

  it("still counts a stale declaration rather than discarding it", () => {
    const ranked = rankJobs(
      [{ job: job({ id: "b", title: "Web Developer" }), keywords: same }],
      [],
      { preferences, career }
    );

    // The candidate did say it. They may be changing direction deliberately.
    expect(ranked[0].titleAffinity).toBeGreaterThan(0);
    expect(ranked[0].titleAffinity).toBeLessThan(1);
  });

  it("keeps full weight on a declared title the history corroborates", () => {
    const ranked = rankJobs(
      [{ job: job({ id: "a", title: "Software Engineer" }), keywords: same }],
      [],
      { preferences, career }
    );

    expect(ranked[0].titleAffinity).toBeCloseTo(1, 1);
  });

  it("leaves declarations alone when there is no history to check against", () => {
    const ranked = rankJobs(
      [{ job: job({ id: "b", title: "Web Developer" }), keywords: same }],
      [],
      { preferences }
    );

    expect(ranked[0].titleAffinity).toBeCloseTo(1, 1);
  });
});
