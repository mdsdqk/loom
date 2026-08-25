import { describe, expect, it } from "vitest";
import { CandidateProfile } from "../src/profile/schema.js";
import { validateMasterResume } from "../src/master-resume/validate.js";

function validProfile(): CandidateProfile {
  return CandidateProfile.parse({
    schema_version: 1,
    status: "usable_with_gaps",
    identity: { name: "Alex Example", location: "Example City", contact: {} },
    role_tracks: [
      {
        id: "application-engineering-senior",
        family: "application-engineering",
        level: "senior",
        target_titles: ["Senior Application Engineer"],
        readiness: {
          tier: "strong",
          reasoning: "Solid evidence.",
          supporting_evidence_ids: ["examplecorp-built"],
          gaps: [],
          candidate_acknowledged: true,
          approved_to_build: true,
        },
      },
    ],
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
                statement: "Built the thing",
                status: "active",
                origin: "resume",
                confirmation: "implicit",
                source_refs: ["source:run-20260824-a:sample-resume#bullet-1"],
              },
              {
                id: "examplecorp-pending",
                statement: "Unconfirmed impact number",
                status: "pending",
                origin: "agent_estimate",
                confirmation: "none",
                source_refs: ["source:run-20260824-a:sample-resume#bullet-1"],
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
      reported: [{ id: "tableau", name: "Tableau" }],
    },
    preferences: [],
    constraints: [],
  });
}

function validResume(): unknown {
  return {
    schema_version: 1,
    track_id: "application-engineering-senior",
    identity: { profile_ref: "identity", name: "Alex Example", location: "Example City" },
    summary: { text: "Senior engineer.", evidence_ids: ["examplecorp-built"] },
    experience: [
      {
        id: "examplecorp",
        profile_ref: "experience.examplecorp",
        company: "ExampleCorp",
        role: "Senior Software Engineer",
        dates: { start: "2020-01", end: "2023-06", precision: "month" },
        bullets: [
          {
            text: "Built the internal platform.",
            emphasis: "high",
            tags: ["platform"],
            evidence_ids: ["examplecorp-built"],
          },
        ],
      },
    ],
    projects: [],
    skills: [{ id: "typescript", profile_ref: "skills.demonstrated.typescript", name: "TypeScript" }],
    recognition: [],
    presentation: { target_pages: 2 },
  };
}

// Deliberately loosely typed, same rationale as profile-validate.test.ts's
// `mutate` helper: these tests construct structurally invalid resumes on
// purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MutableResume = any;

function mutateResume(fn: (resume: MutableResume) => void): unknown {
  const resume: MutableResume = structuredClone(validResume());
  fn(resume);
  return resume;
}

describe("validateMasterResume", () => {
  it("accepts a resume whose profile_refs and evidence_ids all resolve", () => {
    const result = validateMasterResume(validResume(), validProfile());
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects a factual field without evidence_ids (schema-level)", () => {
    const resume = mutateResume((r) => {
      delete r.summary.evidence_ids;
    });
    const result = validateMasterResume(resume, validProfile());
    expect(result.ok).toBe(false);
  });

  it("rejects an evidence_ids reference to a pending claim", () => {
    const resume = mutateResume((r) => {
      r.summary.evidence_ids = ["examplecorp-pending"];
    });
    const result = validateMasterResume(resume, validProfile());
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("non-active"))).toBe(true);
  });

  it("rejects an evidence_ids reference to an unknown claim", () => {
    const resume = mutateResume((r) => {
      r.experience[0].bullets[0].evidence_ids = ["does-not-exist"];
    });
    const result = validateMasterResume(resume, validProfile());
    expect(result.ok).toBe(false);
  });

  it("rejects a profile_ref that doesn't resolve", () => {
    const resume = mutateResume((r) => {
      r.experience[0].profile_ref = "experience.nope";
    });
    const result = validateMasterResume(resume, validProfile());
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("does not resolve"))).toBe(true);
  });

  it("rejects a company that doesn't match the referenced Candidate Profile record", () => {
    const resume = mutateResume((r) => {
      r.experience[0].company = "Different Corp";
    });
    const result = validateMasterResume(resume, validProfile());
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("company"))).toBe(true);
  });

  it("rejects a role that doesn't match the Candidate Profile's title", () => {
    const resume = mutateResume((r) => {
      r.experience[0].role = "Reworded Title";
    });
    const result = validateMasterResume(resume, validProfile());
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("role"))).toBe(true);
  });

  it("rejects dates that don't match the Candidate Profile record", () => {
    const resume = mutateResume((r) => {
      r.experience[0].dates.end = "2024-01";
    });
    const result = validateMasterResume(resume, validProfile());
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("dates"))).toBe(true);
  });

  it("rejects an identity.name mismatch against the Candidate Profile", () => {
    const resume = mutateResume((r) => {
      r.identity.name = "Someone Else";
    });
    const result = validateMasterResume(resume, validProfile());
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("identity.name"))).toBe(true);
  });

  it("rejects a skill name mismatch against the referenced demonstrated skill", () => {
    const resume = mutateResume((r) => {
      r.skills[0].name = "JavaScript";
    });
    const result = validateMasterResume(resume, validProfile());
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate experience ids", () => {
    const resume = mutateResume((r) => {
      r.experience.push({ ...r.experience[0] });
    });
    const result = validateMasterResume(resume, validProfile());
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("duplicate experience id"))).toBe(true);
  });

  it("rejects an invalid presentation.target_pages", () => {
    const resume = mutateResume((r) => {
      r.presentation.target_pages = 0;
    });
    const result = validateMasterResume(resume, validProfile());
    expect(result.ok).toBe(false);
  });

  it("rejects a skill profile_ref pointing at a reported (not demonstrated) skill", () => {
    const resume = mutateResume((r) => {
      r.skills[0].profile_ref = "skills.reported.tableau";
      r.skills[0].name = "Tableau";
    });
    const result = validateMasterResume(resume, validProfile());
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("demonstrated skill"))).toBe(true);
  });

  it("rejects a track_id with no matching Target Track in the Candidate Profile", () => {
    const resume = mutateResume((r) => {
      r.track_id = "application-engineering-staff";
    });
    const result = validateMasterResume(resume, validProfile());
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "track_id")).toBe(true);
  });

  it("rejects a track_id for a Target Track that isn't approved_to_build", () => {
    const profile = CandidateProfile.parse({
      ...validProfile(),
      role_tracks: [
        {
          id: "application-engineering-senior",
          family: "application-engineering",
          level: "senior",
          target_titles: ["Senior Application Engineer"],
          readiness: {
            tier: "stretch",
            reasoning: "Not yet approved.",
            supporting_evidence_ids: [],
            gaps: ["not approved"],
            candidate_acknowledged: true,
            approved_to_build: false,
          },
        },
      ],
    });
    const result = validateMasterResume(validResume(), profile);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "track_id" && i.message.includes("not approved_to_build"))).toBe(true);
  });
});
