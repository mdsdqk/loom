import { CandidateProfile, type EvidenceGroup } from "./schema.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface ValidateCandidateProfileOptions {
  /**
   * Resolves whether a Source Reference points to a record that actually
   * exists (a normalized source record under candidate/sources/, or a
   * transcript event in the owning run's transcript.jsonl). Omit to skip
   * dangling-reference checking — there's nothing to resolve against until
   * the source-normalization tooling exists, so callers built before then
   * get pure structural validation only, not a false "no dangling refs"
   * guarantee.
   */
  resolveSourceRef?: (ref: string) => boolean;
}

/**
 * Validates a loaded Candidate Profile document (e.g. from `loadYaml`)
 * against the schema, returning a structured pass/fail result rather than
 * throwing — this is meant to be consumed by both a CLI and, eventually,
 * the Profile Build skill's own evaluation step, neither of which wants a
 * thrown ZodError.
 */
export function validateCandidateProfile(
  data: unknown,
  options: ValidateCandidateProfileOptions = {}
): ValidationResult {
  const structural = CandidateProfile.safeParse(data);
  if (!structural.success) {
    return {
      ok: false,
      issues: structural.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  const issues: ValidationIssue[] = [];
  if (options.resolveSourceRef) {
    const resolveSourceRef = options.resolveSourceRef;
    for (const ref of collectAllSourceRefs(structural.data)) {
      if (!resolveSourceRef(ref)) {
        issues.push({ path: "source_refs", message: `dangling Source Reference: ${ref}` });
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

function collectAllSourceRefs(profile: CandidateProfile): string[] {
  const refs: string[] = [];
  const collectFromGroups = (groups: EvidenceGroup[]): void => {
    for (const group of groups) {
      for (const claim of group.claims) refs.push(...claim.source_refs);
    }
  };

  for (const entry of profile.experience) collectFromGroups(entry.evidence);
  for (const entry of profile.education) collectFromGroups(entry.evidence);
  for (const entry of profile.projects) collectFromGroups(entry.evidence);
  for (const item of [...profile.preferences, ...profile.constraints]) refs.push(...item.source_refs);

  return refs;
}
