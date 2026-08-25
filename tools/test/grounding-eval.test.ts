import { describe, expect, it } from "vitest";
import { CandidateProfile } from "../src/profile/schema.js";
import { MasterResume } from "../src/master-resume/schema.js";
import type { NormalizedSource } from "../src/source-normalization/schema.js";
import { buildMasterResumeGroundingBatches, buildProfileGroundingBatches } from "../src/grounding-eval/batch.js";
import { combineGroundingResult } from "../src/grounding-eval/result.js";
import { parseJudgeResponse, type JudgeBatchItem } from "../src/grounding-eval/schema.js";

function testProfile(): CandidateProfile {
  return CandidateProfile.parse({
    schema_version: 1,
    status: "usable_with_gaps",
    identity: { name: "Alex Example", contact: {} },
    role_tracks: [],
    experience: [
      {
        id: "examplecorp",
        company: "ExampleCorp",
        title: "Senior Software Engineer",
        dates: { start: "2020-01", end: "2023-06", precision: "month" },
        evidence: [
          {
            id: "examplecorp-platform",
            topic: "Internal platform",
            tags: ["platform"],
            claims: [
              {
                id: "examplecorp-built",
                statement: "Built the internal platform",
                status: "active",
                origin: "resume",
                confirmation: "implicit",
                source_refs: ["source:run-a:sample-resume#para-1"],
              },
              {
                id: "examplecorp-rejected",
                statement: "A claim the candidate rejected",
                status: "rejected",
                origin: "agent_estimate",
                confirmation: "none",
                source_refs: ["source:run-a:sample-resume#para-2"],
              },
              {
                id: "examplecorp-declined-estimate",
                statement: "An impact estimate the candidate declined to confirm",
                status: "pending",
                origin: "agent_estimate",
                confirmation: "none",
                source_refs: ["source:run-a:sample-resume#para-3"],
              },
              {
                id: "examplecorp-interview-claim",
                statement: "Something the candidate said during the interview",
                status: "active",
                origin: "interview",
                confirmation: "soft",
                source_refs: ["transcript:run-a#event-7"],
              },
            ],
          },
        ],
      },
    ],
    education: [],
    projects: [],
    skills: {
      demonstrated: [{ id: "typescript", name: "TypeScript", evidence_ids: ["examplecorp-built"] }],
      reported: [],
    },
    preferences: [],
    constraints: [],
  });
}

describe("buildProfileGroundingBatches", () => {
  it("includes only active claims -- excludes pending, rejected, and superseded", () => {
    const batches = buildProfileGroundingBatches(testProfile(), [], new Map());
    // Two active claims: examplecorp-built and examplecorp-interview-claim.
    // examplecorp-rejected (rejected) and examplecorp-declined-estimate
    // (pending) must not appear -- a pending claim isn't confirmed as true
    // yet, so it shouldn't be forced through the same blocking pass/fail
    // gate as an active one.
    expect(batches).toHaveLength(2);
    expect(batches.map((b) => b.claim_text)).toEqual([
      "Built the internal platform",
      "Something the candidate said during the interview",
    ]);
  });

  it("inlines source text when the source resolves", () => {
    const sources: NormalizedSource[] = [
      {
        run_id: "run-a",
        source_id: "sample-resume",
        source_type: "resume_markdown",
        original_path: "candidate/imports/resume.md",
        records: [{ id: "para-1", text: "Built and shipped the internal platform end to end." }],
      },
    ];
    const batches = buildProfileGroundingBatches(testProfile(), sources, new Map());
    expect(batches[0].sources).toEqual([
      { ref: "source:run-a:sample-resume#para-1", text: "Built and shipped the internal platform end to end." },
    ]);
  });

  it("leaves source text empty when the source doesn't resolve, rather than dropping the reference", () => {
    const batches = buildProfileGroundingBatches(testProfile(), [], new Map());
    expect(batches[0].sources).toEqual([{ ref: "source:run-a:sample-resume#para-1", text: "" }]);
  });

  it("inlines transcript event text for interview-origin claims via the transcript index", () => {
    const transcriptIndex = new Map([
      ["transcript:run-a#event-7", "Yeah, that sounds about right -- roughly a third."],
    ]);
    const batches = buildProfileGroundingBatches(testProfile(), [], transcriptIndex);
    const interviewBatch = batches.find((b) => b.claim_text.includes("interview"));
    expect(interviewBatch?.sources).toEqual([
      { ref: "transcript:run-a#event-7", text: "Yeah, that sounds about right -- roughly a third." },
    ]);
  });

  it("leaves transcript text empty when the event isn't in the index, rather than dropping the reference", () => {
    const batches = buildProfileGroundingBatches(testProfile(), [], new Map());
    const interviewBatch = batches.find((b) => b.claim_text.includes("interview"));
    expect(interviewBatch?.sources).toEqual([{ ref: "transcript:run-a#event-7", text: "" }]);
  });
});

describe("buildMasterResumeGroundingBatches", () => {
  it("resolves evidence_ids to their claim statements, one batch per prose field", () => {
    const resume = MasterResume.parse({
      schema_version: 1,
      track_id: "application-engineering-senior",
      identity: { profile_ref: "identity", name: "Alex Example" },
      summary: { text: "Senior engineer who built things.", evidence_ids: ["examplecorp-built"] },
      experience: [],
      projects: [],
      skills: [],
      recognition: [],
      presentation: { target_pages: 2 },
    });
    const batches = buildMasterResumeGroundingBatches(resume, testProfile(), [], new Map());
    expect(batches).toHaveLength(1);
    expect(batches[0].output_path).toBe("summary");
    expect(batches[0].evidence).toEqual([{ id: "examplecorp-built", statement: "Built the internal platform" }]);
  });

  it("omits evidence for a rejected claim id even if referenced (shouldn't happen post-validation, but batching itself doesn't assume that)", () => {
    const resume = MasterResume.parse({
      schema_version: 1,
      track_id: "application-engineering-senior",
      identity: { profile_ref: "identity", name: "Alex Example" },
      summary: { text: "Text.", evidence_ids: ["examplecorp-rejected"] },
      experience: [],
      projects: [],
      skills: [],
      recognition: [],
      presentation: { target_pages: 2 },
    });
    const batches = buildMasterResumeGroundingBatches(resume, testProfile(), [], new Map());
    expect(batches[0].evidence).toEqual([]);
  });

  it("resolves the cited claim's own source: reference to real source text, not just the claim statement", () => {
    const resume = MasterResume.parse({
      schema_version: 1,
      track_id: "application-engineering-senior",
      identity: { profile_ref: "identity", name: "Alex Example" },
      summary: { text: "Senior engineer who built things.", evidence_ids: ["examplecorp-built"] },
      experience: [],
      projects: [],
      skills: [],
      recognition: [],
      presentation: { target_pages: 2 },
    });
    const sources: NormalizedSource[] = [
      {
        run_id: "run-a",
        source_id: "sample-resume",
        source_type: "resume_markdown",
        original_path: "candidate/imports/resume.md",
        records: [{ id: "para-1", text: "Built and shipped the internal platform end to end." }],
      },
    ];
    const batches = buildMasterResumeGroundingBatches(resume, testProfile(), sources, new Map());
    expect(batches[0].sources).toEqual([
      { ref: "source:run-a:sample-resume#para-1", text: "Built and shipped the internal platform end to end." },
    ]);
  });

  it("resolves the cited claim's own transcript: reference via the transcript index", () => {
    const resume = MasterResume.parse({
      schema_version: 1,
      track_id: "application-engineering-senior",
      identity: { profile_ref: "identity", name: "Alex Example" },
      summary: { text: "Cut signup drop-off noticeably.", evidence_ids: ["examplecorp-interview-claim"] },
      experience: [],
      projects: [],
      skills: [],
      recognition: [],
      presentation: { target_pages: 2 },
    });
    const transcriptIndex = new Map([["transcript:run-a#event-7", "Roughly a third, I'd say."]]);
    const batches = buildMasterResumeGroundingBatches(resume, testProfile(), [], transcriptIndex);
    expect(batches[0].sources).toEqual([{ ref: "transcript:run-a#event-7", text: "Roughly a third, I'd say." }]);
  });
});

function batchItem(outputPath: string): JudgeBatchItem {
  return { output_path: outputPath, claim_text: "irrelevant for these tests", evidence: [], sources: [] };
}

describe("combineGroundingResult", () => {
  it("passes when there are no deterministic issues and every sent batch item has a supported verdict", () => {
    const result = combineGroundingResult(
      [],
      [batchItem("summary")],
      parseJudgeResponse({
        verdicts: [{ output_path: "summary", verdict: "supported", evidence_ids: [], source_refs: [], explanation: "ok" }],
        overall: "pass",
      })
    );
    expect(result.ok).toBe(true);
  });

  it("carries forward deterministic issues even when all verdicts are supported", () => {
    const result = combineGroundingResult(
      [{ path: "experience[0]", message: "dangling reference" }],
      [],
      parseJudgeResponse({ verdicts: [], overall: "pass" })
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
  });

  it("treats unsupported, ambiguous, and contradicted verdicts all as blocking", () => {
    const result = combineGroundingResult(
      [],
      [batchItem("a"), batchItem("b"), batchItem("c")],
      parseJudgeResponse({
        verdicts: [
          { output_path: "a", verdict: "unsupported", evidence_ids: [], source_refs: [], explanation: "no support" },
          { output_path: "b", verdict: "ambiguous", evidence_ids: [], source_refs: [], explanation: "unclear" },
          { output_path: "c", verdict: "contradicted", evidence_ids: [], source_refs: [], explanation: "conflicts" },
        ],
        overall: "fail",
      })
    );
    expect(result.ok).toBe(false);
    // 3 per-claim issues + 1 for the judge's own overall: fail.
    expect(result.issues).toHaveLength(4);
  });

  it("fails when the judge returns an empty verdict list for a non-empty batch -- the exact bug this was written to catch", () => {
    const result = combineGroundingResult(
      [],
      [batchItem("summary"), batchItem("experience[0].bullets[0]")],
      parseJudgeResponse({ verdicts: [], overall: "pass" })
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.every((issue) => issue.message.includes("no verdict"))).toBe(true);
  });

  it("fails when the judge covers some but not all sent batch items", () => {
    const result = combineGroundingResult(
      [],
      [batchItem("summary"), batchItem("experience[0].bullets[0]")],
      parseJudgeResponse({
        verdicts: [{ output_path: "summary", verdict: "supported", evidence_ids: [], source_refs: [], explanation: "ok" }],
        overall: "pass",
      })
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].path).toBe("experience[0].bullets[0]");
  });

  it("fails when overall: fail even though every individual verdict says supported", () => {
    const result = combineGroundingResult(
      [],
      [batchItem("summary")],
      parseJudgeResponse({
        verdicts: [{ output_path: "summary", verdict: "supported", evidence_ids: [], source_refs: [], explanation: "ok" }],
        overall: "fail",
      })
    );
    expect(result.ok).toBe(false);
  });

  it("passes with an empty batch list and an empty verdict list -- nothing to judge is not a failure", () => {
    const result = combineGroundingResult([], [], parseJudgeResponse({ verdicts: [], overall: "pass" }));
    expect(result.ok).toBe(true);
  });
});

describe("parseJudgeResponse", () => {
  it("rejects a malformed judge response rather than trusting it", () => {
    expect(() => parseJudgeResponse({ verdicts: "not an array", overall: "pass" })).toThrow();
  });

  it("rejects an unknown verdict value", () => {
    expect(() =>
      parseJudgeResponse({
        verdicts: [{ output_path: "a", verdict: "probably_fine", evidence_ids: [], source_refs: [], explanation: "x" }],
        overall: "pass",
      })
    ).toThrow();
  });
});
