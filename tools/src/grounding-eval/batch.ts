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
 * say? Only `active`/`pending` claims are judged -- `rejected`/
 * `superseded` claims aren't live output, judging them would be wasted
 * work.
 *
 * `transcript:` refs aren't resolvable yet (no transcript tooling exists
 * — see source-normalization/manifest.ts's resolver, same gap). They're
 * still included in the batch by reference, just without inlined text,
 * so the judge at least sees that a transcript citation exists.
 */
export function buildProfileGroundingBatches(profile: CandidateProfile, sources: NormalizedSource[]): JudgeBatchItem[] {
  const sourceIndex = indexSourceRecords(sources);
  const batches: JudgeBatchItem[] = [];

  const visitGroups = (ownerPath: string, groups: EvidenceGroup[]): void => {
    groups.forEach((group, groupIndex) => {
      group.claims.forEach((claim, claimIndex) => {
        if (claim.status !== "active" && claim.status !== "pending") return;
        batches.push({
          output_path: `${ownerPath}.evidence[${groupIndex}].claims[${claimIndex}]`,
          claim_text: claim.statement,
          evidence: [],
          sources: claim.source_refs.map((ref) => ({ ref, text: sourceIndex.get(ref) ?? "" })),
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
 */
export function buildMasterResumeGroundingBatches(resume: MasterResume, profile: CandidateProfile): JudgeBatchItem[] {
  const claimsById = new Map<string, string>();
  const collect = (groups: EvidenceGroup[]): void => {
    for (const group of groups) {
      for (const claim of group.claims) {
        if (claim.status === "active") claimsById.set(claim.id, claim.statement);
      }
    }
  };
  profile.experience.forEach((entry) => collect(entry.evidence));
  profile.education.forEach((entry) => collect(entry.evidence));
  profile.projects.forEach((entry) => collect(entry.evidence));

  const evidenceFor = (ids: string[]): { id: string; statement: string }[] =>
    ids.filter((id) => claimsById.has(id)).map((id) => ({ id, statement: claimsById.get(id) as string }));

  const batches: JudgeBatchItem[] = [];
  const pushProse = (path: string, text: string, evidenceIds: string[]): void => {
    batches.push({ output_path: path, claim_text: text, evidence: evidenceFor(evidenceIds), sources: [] });
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
