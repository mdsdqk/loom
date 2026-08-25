import type { CandidateProfile } from "../profile/schema.js";
import { MasterResume, type ProseField } from "./schema.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/**
 * Validates a Master Resume against the schema (structural) and against a
 * specific Candidate Profile (cross-reference): every `profile_ref` must
 * resolve and exactly match the referenced record, and every
 * `evidence_ids` entry must reference an *active* Evidence Claim in that
 * profile — a pending, rejected, or superseded claim is a validation
 * failure, not just an unusual one.
 *
 * "Exactly match" is interpreted strictly: a `profile_ref` field signals
 * "this is copied verbatim, not rewritten," so if a field's wording should
 * differ from the Candidate Profile record it needs to be a generated
 * prose field (with evidence_ids) instead, not a profile_ref field with a
 * looser match. Worth confirming this reading — the plan's own example
 * shows `title: "Senior Software Engineer (Lead)"` in the Candidate
 * Profile but `role: "Senior Software Engineer"` in the Master Resume,
 * which this validator would reject as a mismatch.
 */
export function validateMasterResume(data: unknown, profile: CandidateProfile): ValidationResult {
  const structural = MasterResume.safeParse(data);
  if (!structural.success) {
    return {
      ok: false,
      issues: structural.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  const resume = structural.data;
  const issues: ValidationIssue[] = [];

  pushIfInvalid(issues, "track_id", () => {
    const track = profile.role_tracks.find((entry) => entry.id === resume.track_id);
    if (!track) return `track_id does not match any Target Track in the Candidate Profile: ${resume.track_id}`;
    if (!track.readiness.approved_to_build) {
      return `Target Track '${resume.track_id}' is not approved_to_build -- a Master Resume cannot be promoted for it yet`;
    }
    return null;
  });

  const activeClaimIds = collectActiveClaimIds(profile);
  const checkEvidence = (path: string, field: ProseField | { evidence_ids: string[] }): void => {
    for (const id of field.evidence_ids) {
      if (!activeClaimIds.has(id)) {
        issues.push({ path, message: `evidence_ids references a non-active or unknown Evidence Claim: ${id}` });
      }
    }
  };

  pushIfInvalid(issues, "identity", () => {
    const record = resolveProfileRef(profile, resume.identity.profile_ref);
    if (!isRecord(record)) return `profile_ref does not resolve: ${resume.identity.profile_ref}`;
    if (record.name !== resume.identity.name) return `identity.name does not match Candidate Profile`;
    if (resume.identity.location !== undefined && record.location !== resume.identity.location) {
      return `identity.location does not match Candidate Profile`;
    }
    return null;
  });

  checkEvidence("summary", resume.summary);

  resume.experience.forEach((entry, index) => {
    const path = `experience.${index}`;
    pushIfInvalid(issues, `${path}.profile_ref`, () => {
      const record = resolveProfileRef(profile, entry.profile_ref);
      if (!isRecord(record)) return `profile_ref does not resolve: ${entry.profile_ref}`;
      if (record.company !== entry.company) return `${path}.company does not match Candidate Profile`;
      if (record.title !== entry.role) return `${path}.role does not match Candidate Profile experience.title`;
      if (JSON.stringify(record.dates) !== JSON.stringify(entry.dates)) {
        return `${path}.dates does not match Candidate Profile`;
      }
      return null;
    });
    if (entry.intro) checkEvidence(`${path}.intro`, entry.intro);
    entry.bullets.forEach((bullet, bulletIndex) => checkEvidence(`${path}.bullets.${bulletIndex}`, bullet));
  });

  resume.projects.forEach((project, index) => {
    if (project.description) checkEvidence(`projects.${index}.description`, project.description);
  });

  resume.recognition.forEach((item, index) => checkEvidence(`recognition.${index}`, item));

  resume.skills.forEach((skill, index) => {
    const path = `skills.${index}.profile_ref`;
    pushIfInvalid(issues, path, () => {
      if (!skill.profile_ref.startsWith("skills.demonstrated.")) {
        return `profile_ref must point at a demonstrated skill, not '${skill.profile_ref}' -- only demonstrated skills (which already require active evidence) may appear on a Master Resume; a reported-only skill needs evidence and HITL first (see CANDIDATE-PROFILE-SCHEMA.md, Skills)`;
      }
      const record = resolveProfileRef(profile, skill.profile_ref);
      if (!isRecord(record)) return `profile_ref does not resolve: ${skill.profile_ref}`;
      if (record.name !== skill.name) return `skills.${index}.name does not match Candidate Profile`;
      return null;
    });
  });

  return { ok: issues.length === 0, issues };
}

function pushIfInvalid(issues: ValidationIssue[], path: string, check: () => string | null): void {
  const message = check();
  if (message) issues.push({ path, message });
}

function collectActiveClaimIds(profile: CandidateProfile): Set<string> {
  const ids = new Set<string>();
  const collect = (groups: CandidateProfile["experience"][number]["evidence"]): void => {
    for (const group of groups) {
      for (const claim of group.claims) {
        if (claim.status === "active") ids.add(claim.id);
      }
    }
  };
  for (const entry of profile.experience) collect(entry.evidence);
  for (const entry of profile.education) collect(entry.evidence);
  for (const entry of profile.projects) collect(entry.evidence);
  return ids;
}

/** Resolves a dot-path like "experience.examplecorp" or "skills.demonstrated.typescript" against a Candidate Profile: array segments are looked up by `id`, object segments by property name. */
function resolveProfileRef(profile: CandidateProfile, ref: string): unknown {
  let current: unknown = profile;
  for (const segment of ref.split(".")) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      current = current.find((item) => isRecord(item) && item.id === segment);
    } else if (isRecord(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
