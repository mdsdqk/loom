import { leverageScore } from "../report.js";
import { levelFit as computeLevelFit, locationScore as computeLocationScore } from "./structural.js";
import type { Level } from "./structural.js";
import { titleAffinity as computeTitleAffinity } from "./title-affinity.js";
import type { WeightedTitle } from "./title-affinity.js";
import { checkPreferenceStaleness } from "./staleness.js";
import type { CandidatePreferences, Career, Company, Job } from "../schema.js";
import type { KeywordScore } from "./keywords.js";

/**
 * Tier 5 — final ordering.
 *
 * The step most easily lost sight of. Everything before this asks "can the
 * candidate do this job"; this asks "and can they get an introduction, and is
 * it somewhere they'd actually go, and is it the *kind* of role, at the
 * *level*, they are actually aiming for", which is what the whole pipeline is
 * for. A 70% match where a former colleague is senior at the company is worth
 * more than a 90% match where the only connection is one junior contact from
 * six years ago.
 *
 * Every component is kept visible in the output rather than collapsed into a
 * single opaque number, so a candidate can sort by any of them and see why a
 * job ranked where it did.
 */

/** How much referral access counts relative to how well the job fits. */
export const DEFAULT_REFERRAL_WEIGHT = 0.4;

/**
 * How much the candidate's stated city preference counts.
 *
 * Kept modest relative to fit and referral: location was previously a pure
 * gate (in the shortlist or not), and giving it too much pull here would let
 * a bottom-of-the-list preferred city outrank a strong fit at an unlisted but
 * remote role. It exists to break the tie the gate left on the table — a
 * candidate listing `Bengaluru, Dubai, Mumbai, Europe` scored a Bengaluru
 * posting identically to a Mumbai one, because nothing downstream of the
 * pass/fail check ever looked at which preference actually matched.
 */
export const DEFAULT_LOCATION_WEIGHT = 0.15;

/**
 * How much the candidate's stated target titles count.
 *
 * `keyword score` answers "does this posting talk about the candidate's
 * skills", and a QA-automation posting can score well on that alone by
 * naming a lot of technologies — a real run put one at #1 with three more
 * QA/test-automation roles in the top 20, for a candidate whose declared
 * titles never mentioned QA. Title affinity is the independent check: it does
 * not ask what the posting *mentions*, it asks whether the role itself is the
 * kind the candidate said they want. Weighted comparably to location, for the
 * same reason — a strong signal, but not one that should override a genuinely
 * better keyword fit on its own.
 */
// Raised from 0.2 after measuring against the real corpus: at 0.2 a QA
// automation posting still reached position 9, because such postings name a
// great many technologies and so earn high skill coverage while being the
// wrong kind of role. Its title affinity was 0.07 — the signal was there and
// simply carried too little weight. At 0.3 the top of the list is roles the
// candidate actually asked for, and that posting falls to 46.
export const DEFAULT_TITLE_WEIGHT = 0.3;

/**
 * How much the job's seniority matching the candidate's *current* one counts.
 *
 * This is the mechanism that actually addresses a stale declared preference:
 * a candidate whose LinkedIn titles still list "Web Developer" — a level
 * they describe as roughly a fifth of what they now target — cannot have
 * that string safely level-parsed and downweighted (see `levelFit`'s doc for
 * why), but the *job* can be checked against where their career history says
 * they actually are. Weighted comparably to location and title affinity: a
 * strong, independent signal, not one that should singlehandedly override a
 * good keyword or referral fit.
 */
export const DEFAULT_LEVEL_WEIGHT = 0.15;

/**
 * How far a job whose discipline is unconfirmed is held back.
 *
 * "Business Analyst" and "Engagement Manager" reach the shortlist because a
 * keyword taxonomy cannot rule them out from the title alone. They belong in
 * the list, but below anything established as engineering.
 */
export const UNCONFIRMED_DISCIPLINE_FACTOR = 0.6;

/**
 * The titles a candidate is actually aiming at, beyond whatever they typed
 * into LinkedIn's preferences field at some point in the past.
 *
 * Just the current title and the one held immediately before it — not
 * `held_titles`' whole alphabetical set, which cannot distinguish a role held
 * for one summer eight years ago from the one held today. A title identical
 * to the current one (a promotion in place, or two concurrent open-ended
 * rows) is skipped so the second slot names an actually different job.
 */
export function recentHeldTitles(career: Career | undefined): string[] {
  if (!career?.current_title) return [];

  const titles = [career.current_title];
  const previous = career.positions.find((position) => position.title !== career.current_title);
  if (previous) titles.push(previous.title);
  return titles;
}

/**
 * Declared preferences plus recent career history, deduplicated. Title
 * affinity scores against this rather than the declared list alone, so a
 * five-year-stale preferences field does not silently override what the
 * candidate's actual trajectory says they are targeting now.
 */
/**
 * How far a declared title is discounted when the candidate's own history does
 * not corroborate it. Reduced rather than dropped: the candidate did say it,
 * and a stale list is not necessarily a wrong one — they may be deliberately
 * changing direction. This lets history moderate the declaration instead of
 * overruling it.
 */
export const UNCORROBORATED_TITLE_WEIGHT = 0.55;

/**
 * The titles to score a job against, each weighted by how well supported it is.
 *
 * Roles the candidate actually held carry full weight, as does any declared
 * title their history backs up. A declared title flagged stale still counts —
 * it just cannot score a perfect match, which is what stopped a five-year-old
 * "Web Developer" entry from ranking such a job level with their current title.
 */
function effectiveTargetTitles(
  preferences: CandidatePreferences | undefined,
  career?: Career
): WeightedTitle[] {
  const recent = recentHeldTitles(career);
  // Without both a declaration and a history there is nothing to cross-check,
  // so every declared title keeps full weight.
  const stale = new Set(
    preferences && career
      ? checkPreferenceStaleness(preferences, career).map((warning) => warning.declared_title)
      : []
  );

  const targets = new Map<string, number>();
  for (const title of recent) targets.set(title, 1);
  for (const title of preferences?.titles ?? []) {
    const weight = stale.has(title) ? UNCORROBORATED_TITLE_WEIGHT : 1;
    targets.set(title, Math.max(targets.get(title) ?? 0, weight));
  }

  return [...targets.entries()].map(([title, weight]) => ({ title, weight }));
}

export interface RankedJob {
  job: Job;
  /** 0–1 from the keyword pass, as scored. */
  matchScore: number;
  /** Of the candidate's listed skills, the fraction this posting mentions. */
  skillCoverage: number;
  /** Of the posting's own distinctive terms, the fraction the candidate has. */
  demandCoverage: number;
  /** `matchScore` rescaled against the best in this set — what ranking uses. */
  relativeMatch: number;
  /** 0–1, the company's referral leverage normalized across the set. */
  referralScore: number;
  /** 0–1, where this job's location sits in the candidate's stated preference order. */
  locationScore: number;
  /** 0–1, how closely this job's title matches the best of the effective target titles. */
  titleAffinity: number;
  /** 0–1, how the job's seniority compares to the candidate's current level. */
  levelFit: number;
  /** The combined value used for ordering. */
  rank: number;
  /**
   * Same combination as `rank`, with location weighting folded back into fit
   * — for a candidate who wants to sort purely on fit, referral access,
   * title affinity and level fit, or to see how much their own city
   * preference actually moved a given row.
   */
  rankExcludingLocation: number;
  matchedTerms: string[];
  /** False when the title's discipline was guessed rather than established. */
  disciplineConfirmed: boolean;
}

export interface RankOptions {
  /** 0 ignores referrals entirely; 1 ranks purely by who you know. */
  referralWeight?: number;
  /** 0 ignores location entirely. Only applied when `preferences` is given. */
  locationWeight?: number;
  /** 0 ignores title affinity entirely. Only applied when there is an effective target title. */
  titleWeight?: number;
  /** 0 ignores level fit entirely. Only applied when `career.current_level` is known. */
  levelWeight?: number;
  /** Needed to score location; omitted, it is neutral. */
  preferences?: CandidatePreferences;
  /** Needed to widen title targeting and to score level fit; omitted, both are neutral. */
  career?: Career;
}

interface Weights {
  fit: number;
  referral: number;
  location: number;
  title: number;
  level: number;
}

function combine(
  relativeMatch: number,
  referralScore: number,
  location: number,
  title: number,
  level: number,
  weights: Weights,
  confidence: number
): number {
  return Number(
    (
      (relativeMatch * weights.fit +
        referralScore * weights.referral +
        location * weights.location +
        title * weights.title +
        level * weights.level) *
      confidence
    ).toFixed(4)
  );
}

/**
 * Orders jobs by fit, referral access, location preference, title affinity
 * and level fit together.
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
  const referralWeight = options.referralWeight ?? DEFAULT_REFERRAL_WEIGHT;
  const targetTitles = effectiveTargetTitles(options.preferences, options.career);
  // `current_level` is produced only by `titleLevel` (see `buildCareer`), so
  // this cast is recovering a type `schema.ts` deliberately does not carry —
  // it never invents a level the parser did not already assign.
  const currentLevel = options.career?.current_level as Level | undefined;

  // Without stated preferences, career history, or a known current level,
  // there is nothing to score location, title or level fit against, so none
  // of them may silently claim a share of the weight that fit and referral
  // then never get back.
  const locationWeight = options.preferences ? options.locationWeight ?? DEFAULT_LOCATION_WEIGHT : 0;
  const titleWeight = targetTitles.length > 0 ? options.titleWeight ?? DEFAULT_TITLE_WEIGHT : 0;
  const levelWeight = currentLevel !== undefined ? options.levelWeight ?? DEFAULT_LEVEL_WEIGHT : 0;
  const fitWeight = Math.max(0, 1 - referralWeight - locationWeight - titleWeight - levelWeight);

  const leverage = new Map(companies.map((company) => [company.id, leverageScore(company)]));
  const strongest = Math.max(1, ...leverage.values());

  // Both halves must be on the same scale before they are combined. Raw keyword
  // scores occupy a narrow band near zero relative to referral leverage, which
  // spans 0 to 1. Combining them directly let referral decide everything,
  // ranking an analyst role at a well-connected company above a frontend role
  // that actually fitted.
  const bestMatch = Math.max(...scored.map((entry) => entry.keywords.score), 0);

  return scored
    .map(({ job, keywords, disciplineConfirmed = true }) => {
      const referralScore = Number(((leverage.get(job.company_id) ?? 0) / strongest).toFixed(4));
      const relativeMatch =
        bestMatch > 0 ? Number((keywords.score / bestMatch).toFixed(4)) : 0;
      const location = options.preferences ? computeLocationScore(job, options.preferences) : 1;
      const title = computeTitleAffinity(job.title, targetTitles);
      const level = computeLevelFit(job.title, currentLevel);

      // A title the taxonomy could not place is a maybe, not a match. It stays
      // in the list — it may be exactly right — but it does not outrank a role
      // whose discipline is established.
      const confidence = disciplineConfirmed ? 1 : UNCONFIRMED_DISCIPLINE_FACTOR;

      const weights = {
        fit: fitWeight,
        referral: referralWeight,
        location: locationWeight,
        title: titleWeight,
        level: levelWeight,
      };
      const rank = combine(relativeMatch, referralScore, location, title, level, weights, confidence);
      // Location's weight moves back to fit rather than vanishing — the same
      // rule that applied before title affinity and level fit existed: with
      // nothing to spend it on, the removed share belongs to how well the job
      // fits.
      const rankExcludingLocation = combine(
        relativeMatch,
        referralScore,
        location,
        title,
        level,
        { ...weights, fit: fitWeight + locationWeight, location: 0 },
        confidence
      );

      return {
        job,
        matchScore: keywords.score,
        skillCoverage: keywords.skillCoverage,
        demandCoverage: keywords.demandCoverage,
        relativeMatch,
        referralScore,
        locationScore: location,
        titleAffinity: title,
        levelFit: level,
        rank,
        rankExcludingLocation,
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
