import { describe, expect, it } from "vitest";
import { CandidateProfile } from "../src/profile/schema.js";
import { MasterResume } from "../src/master-resume/schema.js";
import type { NormalizedSource } from "../src/source-normalization/schema.js";
import { buildMasterResumeGroundingBatches, buildProfileGroundingBatches } from "../src/grounding-eval/batch.js";
import { combineGroundingResult } from "../src/grounding-eval/result.js";
import { parseJudgeResponse } from "../src/grounding-eval/schema.js";

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
  it("includes active/pending claims, excludes rejected/superseded ones", () => {
    const batches = buildProfileGroundingBatches(testProfile(), []);
    expect(batches).toHaveLength(1);
    expect(batches[0].claim_text).toBe("Built the internal platform");
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
    const batches = buildProfileGroundingBatches(testProfile(), sources);
    expect(batches[0].sources).toEqual([
      { ref: "source:run-a:sample-resume#para-1", text: "Built and shipped the internal platform end to end." },
    ]);
  });

  it("leaves source text empty when the source doesn't resolve, rather than dropping the reference", () => {
    const batches = buildProfileGroundingBatches(testProfile(), []);
    expect(batches[0].sources).toEqual([{ ref: "source:run-a:sample-resume#para-1", text: "" }]);
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
    const batches = buildMasterResumeGroundingBatches(resume, testProfile());
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
    const batches = buildMasterResumeGroundingBatches(resume, testProfile());
    expect(batches[0].evidence).toEqual([]);
  });
});

describe("combineGroundingResult", () => {
  it("passes when there are no deterministic issues and every verdict is supported", () => {
    const result = combineGroundingResult(
      [],
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
      parseJudgeResponse({ verdicts: [], overall: "pass" })
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
  });

  it("treats unsupported, ambiguous, and contradicted verdicts all as blocking", () => {
    const result = combineGroundingResult(
      [],
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
    expect(result.issues).toHaveLength(3);
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
