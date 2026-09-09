import { collapseVariants } from "./collapse.js";
import { scoreDescription } from "./keywords.js";
import { rankJobs } from "./rank.js";
import { structuralVerdict } from "./structural.js";
import type { Level } from "./structural.js";
import { familyVerdict } from "./taxonomy.js";
import type { Family } from "./taxonomy.js";
import type { RankedJob } from "./rank.js";
import type { Company, Job, NetworkImport } from "../schema.js";

/**
 * The matching funnel.
 *
 * Tiers run cheapest first, and each one exists to make the next affordable.
 * Every drop is counted and attributed: a funnel that reports only survivors
 * cannot be tuned, and a matcher whose rejections are invisible will silently
 * discard the job the candidate wanted.
 */

export interface FunnelStage {
  stage: string;
  before: number;
  after: number;
  /** Why jobs were dropped here, by reason. */
  reasons: Record<string, number>;
}

export interface MatchOptions {
  wantedFamilies: Family[];
  minLevel?: Level;
  maxLevel?: Level;
  maxAgeDays?: number;
  /** Reject below this keyword score. Left undefined, nothing is dropped on score. */
  minScore?: number;
  referralWeight?: number;
  now?: Date;
}

export interface MatchResult {
  ranked: RankedJob[];
  /** Survived the cheap tiers but has no description yet — tier 2.5 input. */
  needsDescription: Job[];
  /** Title the taxonomy could not place — a model should decide. */
  needsDisciplineReview: Job[];
  funnel: FunnelStage[];
}

function tally(reasons: Record<string, number>, key: string): void {
  reasons[key] = (reasons[key] ?? 0) + 1;
}

/**
 * Runs the deterministic tiers over a set of jobs.
 *
 * Descriptions are supplied rather than fetched, so this is pure: the same jobs
 * and the same descriptions always produce the same ranking, and the whole
 * funnel is testable without a network.
 */
export function runMatching(
  jobs: Job[],
  network: NetworkImport,
  descriptions: Map<string, string>,
  options: MatchOptions
): MatchResult {
  const funnel: FunnelStage[] = [];

  // Tier 0.5 — one role listed per city becomes one row.
  const collapsed = collapseVariants(jobs);
  funnel.push({
    stage: "collapse duplicate postings",
    before: jobs.length,
    after: collapsed.jobs.length,
    reasons: { "same role, another location": collapsed.merged },
  });

  // Tier 0 — structural rejects, free.
  const structuralReasons: Record<string, number> = {};
  const afterStructural = collapsed.jobs.filter((job) => {
    const verdict = structuralVerdict(job, {
      preferences: network.preferences,
      minLevel: options.minLevel,
      maxLevel: options.maxLevel,
      maxAgeDays: options.maxAgeDays,
      now: options.now,
    });
    if (!verdict.keep) tally(structuralReasons, verdict.stage ?? "unknown");
    return verdict.keep;
  });
  funnel.push({
    stage: "structural",
    before: collapsed.jobs.length,
    after: afterStructural.length,
    reasons: structuralReasons,
  });

  // Tier 2 — discipline from the title.
  const familyReasons: Record<string, number> = {};
  const needsDisciplineReview: Job[] = [];
  const confirmed = new Set<string>();
  const afterFamily = afterStructural.filter((job) => {
    const verdict = familyVerdict(job.title, { wanted: options.wantedFamilies });
    if (!verdict.keep) {
      tally(familyReasons, verdict.family);
      return false;
    }
    if (verdict.needsReview) needsDisciplineReview.push(job);
    else confirmed.add(job.id);
    return true;
  });
  funnel.push({
    stage: "discipline",
    before: afterStructural.length,
    after: afterFamily.length,
    reasons: familyReasons,
  });

  // Tier 2.5 — what still lacks the text tier 3 needs.
  const needsDescription = afterFamily.filter((job) => !descriptions.has(job.id));

  // Tier 3 — keyword overlap, for whatever text is available.
  const scoreReasons: Record<string, number> = {};
  const scored = afterFamily
    .map((job) => ({
      job,
      keywords: scoreDescription(descriptions.get(job.id) ?? "", network.skills),
      disciplineConfirmed: confirmed.has(job.id),
    }))
    .filter(({ job, keywords }) => {
      if (options.minScore === undefined) return true;
      // A job with no description yet cannot be scored, and must not be dropped
      // for a low score it never had the chance to earn.
      if (!descriptions.has(job.id)) return true;
      if (keywords.score >= options.minScore) return true;
      tally(scoreReasons, "below score threshold");
      return false;
    });
  funnel.push({
    stage: "keyword score",
    before: afterFamily.length,
    after: scored.length,
    reasons: scoreReasons,
  });

  // Tier 5 — order by fit and referral access together.
  const ranked = rankJobs(scored, network.companies as Company[], {
    referralWeight: options.referralWeight,
  });

  return { ranked, needsDescription, needsDisciplineReview, funnel };
}

/** Renders the funnel so each stage's cost and effect is visible at a glance. */
export function formatFunnel(funnel: FunnelStage[]): string {
  const lines: string[] = [];
  for (const stage of funnel) {
    const dropped = stage.before - stage.after;
    lines.push(`  ${stage.stage.padEnd(28)} ${String(stage.after).padStart(6)}   (-${dropped})`);
    for (const [reason, count] of Object.entries(stage.reasons).sort((a, b) => b[1] - a[1])) {
      lines.push(`      ${reason.padEnd(26)} ${count}`);
    }
  }
  return lines.join("\n");
}
