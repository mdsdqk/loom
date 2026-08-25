import { describe, expect, it } from "vitest";
import { validateCandidateProfile } from "../src/profile/validate.js";

function validProfile(): unknown {
  return {
    schema_version: 1,
    status: "usable_with_gaps",
    identity: { name: "Alex Example", contact: {} },
    role_tracks: [
      {
        id: "application-engineering-senior",
        family: "application-engineering",
        level: "senior",
        target_titles: ["Senior Application Engineer"],
        readiness: {
          tier: "strong",
          reasoning: "Solid evidence across two roles.",
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
        title: "Senior Engineer",
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
  };
}

// Deep-clones the fixture and applies a mutation, so each test starts from a
// known-valid baseline rather than repeating the whole shape. Deliberately
// loosely typed: these tests construct structurally invalid profiles on
// purpose, which a properly-typed CandidateProfile shape would reject at
// compile time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mutate(fn: (profile: any) => void): unknown {
  const profile = structuredClone(validProfile());
  fn(profile);
  return profile;
}

describe("validateCandidateProfile", () => {
  it("accepts a valid usable_with_gaps profile", () => {
    const result = validateCandidateProfile(validProfile());
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("accepts a valid complete profile", () => {
    const profile = mutate((p) => {
      p.status = "complete";
    });
    expect(validateCandidateProfile(profile).ok).toBe(true);
  });

  it("accepts year-precision dates without a month component", () => {
    const profile = mutate((p) => {
      p.experience[0].dates = { start: "2020", end: "2023", precision: "year" };
    });
    expect(validateCandidateProfile(profile).ok).toBe(true);
  });

  it("rejects a month-precision date given only a year", () => {
    const profile = mutate((p) => {
      p.experience[0].dates.start = "2020";
    });
    const result = validateCandidateProfile(profile);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("month precision"))).toBe(true);
  });

  it("rejects a current role with a non-null end date", () => {
    const profile = mutate((p) => {
      p.experience[0].dates.current = true;
    });
    const result = validateCandidateProfile(profile);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("end: null"))).toBe(true);
  });

  it("rejects an active claim with confirmation: none", () => {
    const profile = mutate((p) => {
      p.experience[0].evidence[0].claims[0].confirmation = "none";
    });
    const result = validateCandidateProfile(profile);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("confirmation: none"))).toBe(true);
  });

  it("rejects an active/pending claim with no Source References", () => {
    const profile = mutate((p) => {
      p.experience[0].evidence[0].claims[0].source_refs = [];
    });
    const result = validateCandidateProfile(profile);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("Source Reference"))).toBe(true);
  });

  it("rejects a Source Reference missing its run qualifier", () => {
    const profile = mutate((p) => {
      p.experience[0].evidence[0].claims[0].source_refs = ["source:sample-resume#bullet-1"];
    });
    const result = validateCandidateProfile(profile);
    expect(result.ok).toBe(false);
  });

  it("rejects a transcript reference missing its run qualifier", () => {
    const profile = mutate((p) => {
      p.experience[0].evidence[0].claims[0].source_refs = ["transcript#event-1"];
    });
    const result = validateCandidateProfile(profile);
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate Evidence Claim ids across different evidence groups", () => {
    const profile = mutate((p) => {
      const claim = p.experience[0].evidence[0].claims[0];
      p.experience[0].evidence.push({
        id: "another-group",
        topic: "x",
        tags: [],
        claims: [{ ...claim }],
      });
    });
    const result = validateCandidateProfile(profile);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("duplicate Evidence Claim id"))).toBe(true);
  });

  it("rejects duplicate Target Track ids", () => {
    const profile = mutate((p) => {
      p.role_tracks.push({ ...p.role_tracks[0] });
    });
    const result = validateCandidateProfile(profile);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("duplicate Target Track id"))).toBe(true);
  });

  it("rejects duplicate experience ids -- a Master Resume profile_ref would otherwise silently bind to the wrong one", () => {
    const profile = mutate((p) => {
      p.experience.push({ ...p.experience[0], evidence: [] });
    });
    const result = validateCandidateProfile(profile);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("duplicate experience id"))).toBe(true);
  });

  it("rejects duplicate education ids", () => {
    const profile = mutate((p) => {
      p.education = [
        { id: "state-university", institution: "State University", evidence: [] },
        { id: "state-university", institution: "A different school reusing the id", evidence: [] },
      ];
    });
    const result = validateCandidateProfile(profile);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("duplicate education id"))).toBe(true);
  });

  it("rejects duplicate project ids", () => {
    const profile = mutate((p) => {
      p.projects = [
        { id: "minimap", name: "Minimap Visualizer", evidence: [] },
        { id: "minimap", name: "A different project reusing the id", evidence: [] },
      ];
    });
    const result = validateCandidateProfile(profile);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("duplicate project id"))).toBe(true);
  });

  it("allows the same id to appear once each in experience, education, and projects -- uniqueness is per-array, not combined", () => {
    const profile = mutate((p) => {
      p.education = [{ id: "examplecorp", institution: "Reuses the experience entry's id on purpose", evidence: [] }];
      p.projects = [{ id: "examplecorp", name: "Also reuses it on purpose", evidence: [] }];
    });
    const result = validateCandidateProfile(profile);
    expect(result.ok).toBe(true);
  });

  it("rejects an unsafe slug (path traversal)", () => {
    const profile = mutate((p) => {
      p.experience[0].id = "../escape";
    });
    expect(validateCandidateProfile(profile).ok).toBe(false);
  });

  it("rejects a Windows-reserved slug", () => {
    const profile = mutate((p) => {
      p.experience[0].id = "con";
    });
    expect(validateCandidateProfile(profile).ok).toBe(false);
  });

  it("rejects a demonstrated skill with no active Evidence Claim", () => {
    const profile = mutate((p) => {
      p.experience[0].evidence[0].claims[0].status = "pending";
      p.experience[0].evidence[0].claims[0].confirmation = "none";
    });
    const result = validateCandidateProfile(profile);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("no active Evidence Claim"))).toBe(true);
  });

  it("rejects approved_to_build without candidate_acknowledged", () => {
    const profile = mutate((p) => {
      p.role_tracks[0].readiness.candidate_acknowledged = false;
    });
    const result = validateCandidateProfile(profile);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("candidate_acknowledged"))).toBe(true);
  });

  describe("compensation and logistics", () => {
    it("accepts a populated, provenance-tracked compensation fact", () => {
      const profile = mutate((p) => {
        p.compensation = {
          items: [
            {
              field: "target_total",
              value: 9000000,
              status: "active",
              confirmation: "soft",
              source_refs: ["transcript:run-20260824-a#event-12"],
            },
          ],
        };
      });
      const result = validateCandidateProfile(profile);
      expect(result.ok).toBe(true);
    });

    it("accepts several logistics facts sharing the same field, one per value", () => {
      const profile = mutate((p) => {
        p.logistics = {
          items: [
            {
              field: "acceptable_locations",
              value: "Example City",
              status: "active",
              confirmation: "implicit",
              source_refs: ["source:run-20260824-a:sample-resume#bullet-2"],
            },
            {
              field: "acceptable_locations",
              value: "Remote",
              status: "active",
              confirmation: "implicit",
              source_refs: ["source:run-20260824-a:sample-resume#bullet-2"],
            },
          ],
        };
      });
      const result = validateCandidateProfile(profile);
      expect(result.ok).toBe(true);
    });

    it("rejects an active compensation fact with confirmation: none", () => {
      const profile = mutate((p) => {
        p.compensation = {
          items: [
            {
              field: "minimum_total",
              value: 7000000,
              status: "active",
              confirmation: "none",
              source_refs: ["transcript:run-20260824-a#event-12"],
            },
          ],
        };
      });
      const result = validateCandidateProfile(profile);
      expect(result.ok).toBe(false);
      expect(result.issues.some((i) => i.message.includes("confirmation: none"))).toBe(true);
    });

    it("rejects an active/pending logistics fact with no Source Reference", () => {
      const profile = mutate((p) => {
        p.logistics = {
          items: [
            { field: "notice_period", value: "30 days", status: "pending", confirmation: "none", source_refs: [] },
          ],
        };
      });
      const result = validateCandidateProfile(profile);
      expect(result.ok).toBe(false);
      expect(result.issues.some((i) => i.message.includes("Source Reference"))).toBe(true);
    });

    it("treats absent compensation/logistics as valid -- optional, never blocking", () => {
      const result = validateCandidateProfile(validProfile());
      expect(result.ok).toBe(true);
    });
  });

  describe("resolveSourceRef", () => {
    it("passes when every Source Reference resolves", () => {
      const result = validateCandidateProfile(validProfile(), { resolveSourceRef: () => true });
      expect(result.ok).toBe(true);
    });

    it("reports a dangling Source Reference when the resolver rejects it", () => {
      const result = validateCandidateProfile(validProfile(), { resolveSourceRef: () => false });
      expect(result.ok).toBe(false);
      expect(result.issues.some((i) => i.message.includes("dangling Source Reference"))).toBe(true);
    });

    it("is skipped entirely when no resolver is given", () => {
      // Same fixture, but without the option — should still pass, since
      // dangling-reference checking is opt-in until source normalization
      // tooling exists to resolve against.
      const result = validateCandidateProfile(validProfile());
      expect(result.ok).toBe(true);
    });

    it("catches a dangling Source Reference on a compensation/logistics fact, not just Evidence Claims", () => {
      const profile = mutate((p) => {
        p.compensation = {
          items: [
            {
              field: "target_total",
              value: 9000000,
              status: "active",
              confirmation: "soft",
              source_refs: ["transcript:run-20260824-a#event-does-not-exist"],
            },
          ],
        };
      });
      const resolveSourceRef = (ref: string): boolean => ref !== "transcript:run-20260824-a#event-does-not-exist";
      const result = validateCandidateProfile(profile, { resolveSourceRef });
      expect(result.ok).toBe(false);
      expect(result.issues.some((i) => i.message.includes("dangling Source Reference"))).toBe(true);
    });
  });
});
