import type { CandidateProfile, EvidenceGroup } from "../profile/schema.js";
import type { MasterResume } from "../master-resume/schema.js";
import type { NormalizedSource } from "../source-normalization/schema.js";
import type { JudgeBatchItem } from "./schema.js";

function indexSourceRecords(sources: NormalizedSource[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const source of sources) {
    for (const record of source.records) {
      index.set(`source:${source.run_id}:${source.source_id}#${record.id}`, record.text);
    }
  }
  return index;
}

/**
 * Builds bounded judge batches for a Candidate Profile's own grounding
 * eval: does each claim's `statement` actually match what its sources
 * say? Only `active` claims are judged — a `pending` claim is, by
 * definition, not yet confirmed as true, so forcing it through the same
 * pass/fail gate as an active claim would block promotion over a claim
 * nobody is actually asserting yet (`usable_with_gaps` explicitly treats
 * an unresolved pending claim as a non-blocking gap, not a failure).
 *
 * `transcriptIndex` (from `../transcript.js`'s `indexTranscriptEvents`,
 * run-qualified `transcript:{run-id}#{event-id}` -> event text) resolves
 * interview-origin claims' `transcript:` refs — required, not optional,
 * since silently defaulting it away would reproduce exactly the
 * "empty-string source text" bug this parameter exists to fix.
 */
export function buildProfileGroundingBatches(
  profile: CandidateProfile,
  sources: NormalizedSource[],
  transcriptIndex: Map<string, string>
): JudgeBatchItem[] {
  const sourceIndex = indexSourceRecords(sources);
  const resolveRefText = (ref: string): string => sourceIndex.get(ref) ?? transcriptIndex.get(ref) ?? "";
  const batches: JudgeBatchItem[] = [];

  const visitGroups = (ownerPath: string, groups: EvidenceGroup[]): void => {
    groups.forEach((group, groupIndex) => {
      group.claims.forEach((claim, claimIndex) => {
        if (claim.status !== "active") return;
        batches.push({
          output_path: `${ownerPath}.evidence[${groupIndex}].claims[${claimIndex}]`,
          claim_text: claim.statement,
          evidence: [],
          sources: claim.source_refs.map((ref) => ({ ref, text: resolveRefText(ref) })),
        });
      });
    });
  };

  profile.experience.forEach((entry, index) => visitGroups(`experience[${index}]`, entry.evidence));
  profile.education.forEach((entry, index) => visitGroups(`education[${index}]`, entry.evidence));
  profile.projects.forEach((entry, index) => visitGroups(`projects[${index}]`, entry.evidence));

  return batches;
}

/**
 * Builds bounded judge batches for a Master Resume's grounding eval: does
 * each generated prose field match what its referenced (active) Evidence
 * Claims actually support? Structured `profile_ref` fields aren't
 * included here — those are checked deterministically (exact match, see
 * master-resume/validate.ts), not by judgment; only generated/
 * transformed prose needs the judge, per the plan.
 *
 * Per ADR 0003/ticket 009 the judge gets the referenced Candidate Profile
 * evidence *and* the normalized sources/transcript events those claims
 * themselves cite — not just the claim statements in isolation, which
 * would make this only a paraphrase check against producer-written text
 * rather than a check against the candidate-controlled corpus. `sources`
 * and `transcriptIndex` are the same inputs `buildProfileGroundingBatches`
 * takes, for the same reason.
 */
export function buildMasterResumeGroundingBatches(
  resume: MasterResume,
  profile: CandidateProfile,
  sources: NormalizedSource[],
  transcriptIndex: Map<string, string>
): JudgeBatchItem[] {
  const sourceIndex = indexSourceRecords(sources);
  const resolveRefText = (ref: string): string => sourceIndex.get(ref) ?? transcriptIndex.get(ref) ?? "";

  const claimsById = new Map<string, { statement: string; sourceRefs: string[] }>();
  const collect = (groups: EvidenceGroup[]): void => {
    for (const group of groups) {
      for (const claim of group.claims) {
        if (claim.status === "active") claimsById.set(claim.id, { statement: claim.statement, sourceRefs: claim.source_refs });
      }
    }
  };
  profile.experience.forEach((entry) => collect(entry.evidence));
  profile.education.forEach((entry) => collect(entry.evidence));
  profile.projects.forEach((entry) => collect(entry.evidence));

  const evidenceFor = (ids: string[]): { id: string; statement: string }[] =>
    ids
      .filter((id) => claimsById.has(id))
      .map((id) => ({ id, statement: (claimsById.get(id) as { statement: string }).statement }));

  const sourcesFor = (ids: string[]): { ref: string; text: string }[] => {
    const refs = new Set<string>();
    for (const id of ids) {
      const claim = claimsById.get(id);
      if (claim) for (const ref of claim.sourceRefs) refs.add(ref);
    }
    return [...refs].map((ref) => ({ ref, text: resolveRefText(ref) }));
  };

  const batches: JudgeBatchItem[] = [];
  const pushProse = (path: string, text: string, evidenceIds: string[]): void => {
    batches.push({ output_path: path, claim_text: text, evidence: evidenceFor(evidenceIds), sources: sourcesFor(evidenceIds) });
  };

  pushProse("summary", resume.summary.text, resume.summary.evidence_ids);
  resume.experience.forEach((entry, index) => {
    if (entry.intro) pushProse(`experience[${index}].intro`, entry.intro.text, entry.intro.evidence_ids);
    entry.bullets.forEach((bullet, bulletIndex) =>
      pushProse(`experience[${index}].bullets[${bulletIndex}]`, bullet.text, bullet.evidence_ids)
    );
  });
  resume.projects.forEach((project, index) => {
    if (project.description) {
      pushProse(`projects[${index}].description`, project.description.text, project.description.evidence_ids);
    }
  });
  resume.recognition.forEach((item, index) => pushProse(`recognition[${index}]`, item.text, item.evidence_ids));

  return batches;
}
