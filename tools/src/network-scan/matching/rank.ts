import { leverageScore } from "../report.js";
import type { Company, Job } from "../schema.js";
import type { KeywordScore } from "./keywords.js";

/**
 * Tier 5 — final ordering.
 *
 * The step most easily lost sight of. Everything before this asks "can the
 * candidate do this job"; this asks "and can they get an introduction", which
 * is what the whole pipeline is for. A 70% match where a former colleague is
 * senior at the company is worth more than a 90% match where the only
 * connection is one junior contact from six years ago.
 *
 * Both halves are kept visible in the output rather than collapsed into a
 * single opaque number, so a candidate can sort by either and see why a job
 * ranked where it did.
 */

/** How much referral access counts relative to how well the job fits. */
export const DEFAULT_REFERRAL_WEIGHT = 0.4;

/**
 * How far a job whose discipline is unconfirmed is held back.
 *
 * "Business Analyst" and "Engagement Manager" reach the shortlist because a
 * keyword taxonomy cannot rule them out from the title alone. They belong in
 * the list, but below anything established as engineering.
 */
export const UNCONFIRMED_DISCIPLINE_FACTOR = 0.6;

export interface RankedJob {
  job: Job;
  /** 0–1 from the keyword pass, as scored. */
  matchScore: number;
  /** `matchScore` rescaled against the best in this set — what ranking uses. */
  relativeMatch: number;
  /** 0–1, the company's referral leverage normalized across the set. */
  referralScore: number;
  /** The combined value used for ordering. */
  rank: number;
  matchedTerms: string[];
  /** False when the title's discipline was guessed rather than established. */
  disciplineConfirmed: boolean;
}

export interface RankOptions {
  /** 0 ignores referrals entirely; 1 ranks purely by who you know. */
  referralWeight?: number;
}

/**
 * Orders jobs by fit and referral access together.
 *
 * Leverage is normalized against the strongest company in this set rather than
 * an absolute scale: what matters is which of *these* companies the candidate
 * has the most pull at.
 */
export function rankJobs(
  scored: { job: Job; keywords: KeywordScore; disciplineConfirmed?: boolean }[],
  companies: Company[],
  options: RankOptions = {}
): RankedJob[] {
  const weight = options.referralWeight ?? DEFAULT_REFERRAL_WEIGHT;
  const leverage = new Map(companies.map((company) => [company.id, leverageScore(company)]));
  const strongest = Math.max(1, ...leverage.values());

  // Both halves must be on the same scale before they are combined. Raw keyword
  // scores occupy a narrow band near zero — the whole of one real run fell
  // between 0.07 and 0.25 — while referral leverage spans 0 to 1. Combining
  // them directly let referral decide everything, ranking an analyst role at a
  // well-connected company above a frontend role that actually fitted.
  const bestMatch = Math.max(...scored.map((entry) => entry.keywords.score), 0);

  return scored
    .map(({ job, keywords, disciplineConfirmed = true }) => {
      const referralScore = Number(((leverage.get(job.company_id) ?? 0) / strongest).toFixed(4));
      const relativeMatch =
        bestMatch > 0 ? Number((keywords.score / bestMatch).toFixed(4)) : 0;

      // A title the taxonomy could not place is a maybe, not a match. It stays
      // in the list — it may be exactly right — but it does not outrank a role
      // whose discipline is established.
      const confidence = disciplineConfirmed ? 1 : UNCONFIRMED_DISCIPLINE_FACTOR;

      return {
        job,
        matchScore: keywords.score,
        relativeMatch,
        referralScore,
        rank: Number(
          ((relativeMatch * (1 - weight) + referralScore * weight) * confidence).toFixed(4)
        ),
        matchedTerms: keywords.matched.map((entry) => entry.term),
        disciplineConfirmed,
      };
    })
    .sort(
      (a, b) =>
        b.rank - a.rank ||
        b.matchScore - a.matchScore ||
        // Stable final tiebreak, so equal jobs do not reorder between runs.
        (a.job.id < b.job.id ? -1 : a.job.id > b.job.id ? 1 : 0)
    );
}
