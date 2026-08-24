import { z } from "zod";

/**
 * Runtime schema + inferred types for the Candidate Profile
 * (`candidate/profile.yml`), per docs/plans/profile-build-implementation.md
 * and docs/CONTEXT.md.
 *
 * Parts explicitly spelled out in the plan (identity, structured dates,
 * evidence claims, target tracks, preferences/constraints, compensation,
 * logistics) follow its YAML examples closely. Parts the plan names as
 * checkpoints but never shows a concrete shape for (education, projects,
 * narrative) are this file's own extrapolation, following the same
 * evidence-group pattern used for experience — flagged inline. Confirm or
 * correct these before treating them as settled.
 */

// ---------------------------------------------------------------------------
// Slugs — used for Evidence Claim IDs, Evidence Group IDs, Target Track IDs,
// experience/education/project IDs, skill IDs, and preference/constraint IDs.
// Lowercase ASCII letters, digits, single hyphens; no path traversal or
// Windows-reserved names (this repo develops on Windows and these IDs may
// become directory segments, e.g. candidate/tracks/{track-id}/).
// ---------------------------------------------------------------------------

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

function isSafeSlug(value: string): boolean {
  if (!SLUG_PATTERN.test(value)) return false;
  if (value === "." || value === "..") return false;
  if (WINDOWS_RESERVED_NAMES.has(value)) return false;
  return true;
}

export const Slug = z
  .string()
  .refine(isSafeSlug, "must be lowercase, hyphen-separated, and not a path-traversal or reserved name");

// ---------------------------------------------------------------------------
// Source References — compact, run-qualified links from a claim to a
// normalized source record or an exact transcript event.
// ---------------------------------------------------------------------------

const SOURCE_REF_PATTERN = /^source:[a-z0-9-]+:[a-z0-9-]+#[a-z0-9-]+$/;
const TRANSCRIPT_REF_PATTERN = /^transcript:[a-z0-9-]+#[a-z0-9-]+$/;

export const SourceRef = z
  .string()
  .refine(
    (value) => SOURCE_REF_PATTERN.test(value) || TRANSCRIPT_REF_PATTERN.test(value),
    "must be 'source:{run-id}:{source-id}#{record-id}' or 'transcript:{run-id}#{event-id}'"
  );

// ---------------------------------------------------------------------------
// Structured dates
// ---------------------------------------------------------------------------

export const StructuredDate = z
  .object({
    start: z.string(),
    end: z.string().nullable(),
    precision: z.enum(["year", "month"]),
    current: z.boolean().optional(),
  })
  .superRefine((date, ctx) => {
    const pattern = date.precision === "year" ? /^\d{4}$/ : /^\d{4}-\d{2}$/;
    if (!pattern.test(date.start)) {
      ctx.addIssue({ code: "custom", path: ["start"], message: `must match ${date.precision} precision` });
    }
    if (date.end !== null && !pattern.test(date.end)) {
      ctx.addIssue({ code: "custom", path: ["end"], message: `must match ${date.precision} precision` });
    }
    if (date.current && date.end !== null) {
      ctx.addIssue({ code: "custom", path: ["end"], message: "a current role/track must have end: null" });
    }
  });

// ---------------------------------------------------------------------------
// Evidence Claims and Evidence Groups
// ---------------------------------------------------------------------------

export const ClaimStatus = z.enum(["active", "pending", "rejected", "superseded"]);
export const ConfirmationTier = z.enum(["implicit", "soft", "hard", "none"]);
export const ClaimOrigin = z.enum(["resume", "linkedin", "interview", "agent_estimate", "seed_profile"]);

export const EvidenceClaim = z
  .object({
    id: Slug,
    statement: z.string().min(1),
    status: ClaimStatus,
    origin: ClaimOrigin,
    confirmation: ConfirmationTier,
    source_refs: z.array(SourceRef),
  })
  .superRefine((claim, ctx) => {
    const isUsable = claim.status === "active" || claim.status === "pending";
    if (isUsable && claim.source_refs.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["source_refs"],
        message: "active/pending claims require at least one Source Reference",
      });
    }
    if (claim.status === "active" && claim.confirmation === "none") {
      ctx.addIssue({
        code: "custom",
        path: ["confirmation"],
        message: "an active claim cannot have confirmation: none",
      });
    }
  });

export const EvidenceGroup = z.object({
  id: Slug,
  topic: z.string().min(1),
  tags: z.array(z.string()),
  claims: z.array(EvidenceClaim).min(1),
});

// ---------------------------------------------------------------------------
// Identity and narrative
// ---------------------------------------------------------------------------

export const Identity = z.object({
  name: z.string().min(1),
  preferred_name: z.string().optional(),
  location: z.string().optional(),
  contact: z.object({
    email: z.string().optional(),
    phone: z.string().optional(),
    linkedin: z.string().optional(),
    github: z.string().optional(),
    portfolio: z.string().optional(),
  }),
  open_to_relocation: z.boolean().optional(),
});

// Extrapolated: the plan names "narrative and presentation preferences" as a
// checkpoint (#8) but never shows a concrete shape. Kept deliberately small.
export const Narrative = z.object({
  one_sentence: z.string().optional(),
  positioning_notes: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Experience, Education, Projects
// ---------------------------------------------------------------------------

export const Experience = z.object({
  id: Slug,
  company: z.string().min(1),
  title: z.string().min(1),
  dates: StructuredDate,
  evidence: z.array(EvidenceGroup),
});

// Extrapolated: same evidence-group pattern as Experience, since the plan
// only says checkpoint #1 covers "education" without a concrete shape.
export const Education = z.object({
  id: Slug,
  institution: z.string().min(1),
  degree: z.string().optional(),
  field_of_study: z.string().optional(),
  dates: StructuredDate.optional(),
  evidence: z.array(EvidenceGroup),
});

// Extrapolated: same pattern, for checkpoint #4 "independent projects."
export const Project = z.object({
  id: Slug,
  name: z.string().min(1),
  description: z.string().optional(),
  dates: StructuredDate.optional(),
  evidence: z.array(EvidenceGroup),
});

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export const DemonstratedSkill = z.object({
  id: Slug,
  name: z.string().min(1),
  evidence_ids: z.array(Slug).min(1),
});

export const ReportedSkill = z.object({
  id: Slug,
  name: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Preferences and constraints (same shape; kept as two top-level lists per
// the plan)
// ---------------------------------------------------------------------------

export const PreferenceItem = z.object({
  id: Slug,
  statement: z.string().min(1),
  authority: z.enum(["hard", "strong", "soft"]),
  applies_to: z.array(z.string()).min(1),
  status: ClaimStatus,
  source_refs: z.array(SourceRef),
});

// ---------------------------------------------------------------------------
// Target Tracks
// ---------------------------------------------------------------------------

export const TrackReadiness = z
  .object({
    tier: z.enum(["strong", "stretch", "insufficient"]),
    reasoning: z.string().min(1),
    supporting_evidence_ids: z.array(Slug),
    gaps: z.array(z.string()),
    candidate_acknowledged: z.boolean(),
    approved_to_build: z.boolean(),
  })
  .refine((readiness) => !readiness.approved_to_build || readiness.candidate_acknowledged, {
    message: "approved_to_build requires candidate_acknowledged",
    path: ["approved_to_build"],
  });

export const RoleTrack = z.object({
  id: Slug,
  family: z.string().min(1),
  level: z.string().min(1),
  target_titles: z.array(z.string()).min(1),
  positioning: z.string().optional(),
  readiness: TrackReadiness,
});

// ---------------------------------------------------------------------------
// Optional compensation and logistics — future matching data, never blocking
// ---------------------------------------------------------------------------

export const Compensation = z.object({
  current: z
    .object({
      fixed: z.number().nullable().optional(),
      variable: z.number().nullable().optional(),
      equity: z.string().nullable().optional(),
      currency: z.string().optional(),
    })
    .optional(),
  expectations: z
    .object({
      minimum_fixed: z.number().nullable().optional(),
      minimum_total: z.number().nullable().optional(),
      target_total: z.number().nullable().optional(),
      acceptable_variable_percentage: z.number().nullable().optional(),
      equity_preference: z.enum(["none", "open", "preferred"]).optional(),
      cash_equity_tradeoff: z.string().nullable().optional(),
    })
    .optional(),
});

export const Logistics = z.object({
  current_location: z.string().optional(),
  acceptable_locations: z.array(z.string()).optional(),
  workplace_modes: z.array(z.enum(["remote", "hybrid", "onsite"])).optional(),
  relocation: z.record(z.string(), z.unknown()).optional(),
  work_authorization: z.array(z.string()).optional(),
  sponsorship_required: z.boolean().nullable().optional(),
  notice_period: z.string().nullable().optional(),
  earliest_start_date: z.string().nullable().optional(),
  employment_types: z.array(z.string()).optional(),
  travel_tolerance: z.string().nullable().optional(),
  timezone_overlap: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Top-level Candidate Profile
// ---------------------------------------------------------------------------

const CandidateProfileShape = z.object({
  schema_version: z.literal(1),
  status: z.enum(["in_progress", "usable_with_gaps", "complete"]),
  identity: Identity,
  narrative: Narrative.optional(),
  role_tracks: z.array(RoleTrack),
  experience: z.array(Experience),
  education: z.array(Education),
  projects: z.array(Project),
  skills: z.object({
    demonstrated: z.array(DemonstratedSkill),
    reported: z.array(ReportedSkill),
  }),
  preferences: z.array(PreferenceItem),
  constraints: z.array(PreferenceItem),
  compensation: Compensation.optional(),
  logistics: Logistics.optional(),
});

function collectDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

export const CandidateProfile = CandidateProfileShape.superRefine((profile, ctx) => {
  // Global uniqueness within each ID namespace (plan: "global uniqueness
  // within their namespace").
  const trackIds = profile.role_tracks.map((track) => track.id);
  for (const duplicate of collectDuplicates(trackIds)) {
    ctx.addIssue({ code: "custom", path: ["role_tracks"], message: `duplicate Target Track id: ${duplicate}` });
  }

  const evidenceGroupsByOwner = [
    ...profile.experience.map((entry) => entry.evidence),
    ...profile.education.map((entry) => entry.evidence),
    ...profile.projects.map((entry) => entry.evidence),
  ];
  const allGroups = evidenceGroupsByOwner.flat();
  const allClaims = allGroups.flatMap((group) => group.claims);

  for (const duplicate of collectDuplicates(allGroups.map((group) => group.id))) {
    ctx.addIssue({ code: "custom", path: ["experience"], message: `duplicate Evidence Group id: ${duplicate}` });
  }
  for (const duplicate of collectDuplicates(allClaims.map((claim) => claim.id))) {
    ctx.addIssue({ code: "custom", path: ["experience"], message: `duplicate Evidence Claim id: ${duplicate}` });
  }

  const skillIds = [
    ...profile.skills.demonstrated.map((skill) => skill.id),
    ...profile.skills.reported.map((skill) => skill.id),
  ];
  for (const duplicate of collectDuplicates(skillIds)) {
    ctx.addIssue({ code: "custom", path: ["skills"], message: `duplicate skill id: ${duplicate}` });
  }

  const preferenceIds = [...profile.preferences.map((p) => p.id), ...profile.constraints.map((p) => p.id)];
  for (const duplicate of collectDuplicates(preferenceIds)) {
    ctx.addIssue({ code: "custom", path: ["preferences"], message: `duplicate preference/constraint id: ${duplicate}` });
  }

  // Demonstrated skills require at least one *active* Evidence Claim id.
  const activeClaimIds = new Set(allClaims.filter((claim) => claim.status === "active").map((claim) => claim.id));
  profile.skills.demonstrated.forEach((skill, index) => {
    const hasActiveEvidence = skill.evidence_ids.some((id) => activeClaimIds.has(id));
    if (!hasActiveEvidence) {
      ctx.addIssue({
        code: "custom",
        path: ["skills", "demonstrated", index, "evidence_ids"],
        message: `demonstrated skill '${skill.id}' has no active Evidence Claim`,
      });
    }
  });
});

export type Slug = z.infer<typeof Slug>;
export type SourceRef = z.infer<typeof SourceRef>;
export type StructuredDate = z.infer<typeof StructuredDate>;
export type EvidenceClaim = z.infer<typeof EvidenceClaim>;
export type EvidenceGroup = z.infer<typeof EvidenceGroup>;
export type Identity = z.infer<typeof Identity>;
export type Narrative = z.infer<typeof Narrative>;
export type Experience = z.infer<typeof Experience>;
export type Education = z.infer<typeof Education>;
export type Project = z.infer<typeof Project>;
export type DemonstratedSkill = z.infer<typeof DemonstratedSkill>;
export type ReportedSkill = z.infer<typeof ReportedSkill>;
export type PreferenceItem = z.infer<typeof PreferenceItem>;
export type TrackReadiness = z.infer<typeof TrackReadiness>;
export type RoleTrack = z.infer<typeof RoleTrack>;
export type Compensation = z.infer<typeof Compensation>;
export type Logistics = z.infer<typeof Logistics>;
export type CandidateProfile = z.infer<typeof CandidateProfile>;

/** Parses `unknown` input (e.g. a loaded YAML document) into a typed, structurally-valid Candidate Profile. */
export function parseCandidateProfile(data: unknown): CandidateProfile {
  return CandidateProfile.parse(data);
}
