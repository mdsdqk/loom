import type { CandidatePreferences, Job } from "../schema.js";

/**
 * Tier 0 — rejections that need nothing but the fields already held.
 *
 * These run before anything that costs a request or a token, and they exist to
 * make the expensive passes affordable rather than to judge fit. Every
 * rejection records a reason: a funnel that reports only survivors cannot be
 * tuned, and a filter whose behaviour cannot be inspected will quietly discard
 * good jobs.
 */

export type RejectionStage = "seniority" | "employment_type" | "location" | "freshness";

export interface Verdict {
  keep: boolean;
  stage?: RejectionStage;
  reason?: string;
}

const KEEP: Verdict = { keep: true };

/**
 * Levels a title can advertise. Ordered, so a candidate can say "not below mid"
 * and "not above lead" independently.
 */
export const LEVELS = ["intern", "junior", "mid", "senior", "lead", "executive"] as const;
export type Level = (typeof LEVELS)[number];

const LEVEL_PATTERNS: [Level, RegExp][] = [
  ["intern", /\b(intern|internship|trainee|apprentice|co-?op|graduate program|working student)\b/i],
  [
    "executive",
    /\b(chief|c[teofi]o|vp|vice president|svp|evp|head of|director|general manager|partner)\b/i,
  ],
  ["lead", /\b(lead|principal|staff|architect|manager|mgr)\b/i],
  ["senior", /\b(senior|sr\.?|iii|3)\b/i],
  ["junior", /\b(junior|jr\.?|associate|entry[- ]level|fresher|\bi\b|\b1\b)\b/i],
];

/**
 * Reads the level a job title advertises.
 *
 * Checked most-specific first: "Senior Engineering Manager" is a lead role, and
 * "Director of Engineering" is an executive one, regardless of the other words
 * present. A title that advertises nothing is `mid`, which is the honest
 * default rather than a guess in either direction.
 */
export function titleLevel(title: string): Level {
  for (const [level, pattern] of LEVEL_PATTERNS) {
    if (pattern.test(title)) return level;
  }
  return "mid";
}

export interface StructuralCriteria {
  preferences: CandidatePreferences;
  /** Inclusive level window. Omit either end to leave it open. */
  minLevel?: Level;
  maxLevel?: Level;
  /** Drop postings older than this, where the provider reports a date. */
  maxAgeDays?: number;
  now?: Date;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter(Boolean));
}

/**
 * Cities that answer to more than one name.
 *
 * Not a geography database — just the renamings and anglicisations that appear
 * in real job boards. Found by calibration: a saved Epicor role in "India,
 * Bangalore" was rejected against a stated preference of "Bengaluru", which is
 * the same city under its current name.
 */
const CITY_ALIASES: string[][] = [
  ["bengaluru", "bangalore", "bangalury"],
  ["mumbai", "bombay"],
  ["chennai", "madras"],
  ["kolkata", "calcutta"],
  ["pune", "poona"],
  ["gurugram", "gurgaon"],
  ["thiruvananthapuram", "trivandrum"],
  ["kochi", "cochin"],
  ["vadodara", "baroda"],
  ["dubai", "dxb"],
];

const ALIAS_LOOKUP = new Map<string, string[]>(
  CITY_ALIASES.flatMap((group) => group.map((name) => [name, group] as [string, string[]]))
);

/**
 * A location string that states a count rather than a place — Workday returns
 * "4 Locations" when a posting spans several. It names nowhere, so it must be
 * treated as unknown rather than as a place that fails to match.
 */
const LOCATION_COUNT = /^\s*\d+\s+locations?\s*$/i;

/**
 * Index of the first preference a job's named locations satisfy, or -1.
 *
 * Shared by `locationCompatible` (which only cares whether this is -1) and
 * `locationScore` (which cares *which* preference matched, so a candidate's
 * first choice can outrank their fourth). One alias table, one matching rule,
 * used both to gate and to rank — duplicating it was how the two would have
 * quietly drifted apart.
 */
function matchedPreferenceIndex(job: Job, preferences: CandidatePreferences): number {
  if (job.locations.length === 0) return -1;

  // A posting that only says how many locations it spans names none of them.
  const named = job.locations.filter((location) => !LOCATION_COUNT.test(location));
  if (named.length === 0) return -1;

  const places = tokens(named.join(" "));
  return preferences.locations.findIndex((wanted) => {
    const parts = normalize(wanted).split(" ").filter(Boolean);
    if (parts.length === 0) return false;
    return parts.every((part) => {
      const aliases = ALIAS_LOOKUP.get(part);
      return aliases ? aliases.some((alias) => places.has(alias)) : places.has(part);
    });
  });
}

/**
 * Whether a job's location is compatible with the candidate's.
 *
 * Unknown locations are kept: the provider not reporting one is not evidence
 * against the job. Matching is literal, so a named region does not imply its
 * cities — "Europe" will not match "Berlin, Germany" without a geography table,
 * which is deliberately out of scope.
 */
export function locationCompatible(job: Job, preferences: CandidatePreferences): boolean {
  if (preferences.locations.length === 0) return true;
  if (job.remote) return true;
  if (job.locations.length === 0) return true;

  const named = job.locations.filter((location) => !LOCATION_COUNT.test(location));
  if (named.length === 0) return true;

  return matchedPreferenceIndex(job, preferences) >= 0;
}

/** The job's first-listed preference matches perfectly; scores taper from there. */
const TOP_PREFERENCE_SCORE = 1;
/** How much each step down the candidate's preference order costs. */
const PREFERENCE_STEP = 0.15;
/** A named preference never scores below this, however far down the list it sits. */
const MIN_PREFERENCE_SCORE = 0.4;
/** Remote work is compatible with any preference but endorses none of them. */
const REMOTE_LOCATION_SCORE = 0.6;
/** The provider not reporting a location is not evidence against the job. */
const UNKNOWN_LOCATION_SCORE = 0.3;
/** Reachable only when `locationCompatible` would already have rejected the job. */
const NOT_WANTED_LOCATION_SCORE = 0.1;

/**
 * How well a job's location matches the candidate's stated preference order.
 *
 * Location used to be a pure gate: a job either passed `locationCompatible`
 * or it didn't, and every survivor counted the same in ranking. That silently
 * discarded the order a candidate gives their own preferences in — someone
 * who lists `Bengaluru, Dubai, Mumbai, Europe` is not indifferent between
 * them, but a Bengaluru posting and a Mumbai one came out identically ranked.
 *
 * Remote and unknown are both deliberately non-zero and deliberately not
 * equal to a matched preference: remote is a real, flexible option (scored
 * above unknown) but endorses no particular city, while an unreported
 * location is simply missing information, not a mismatch.
 */
export function locationScore(job: Job, preferences: CandidatePreferences): number {
  if (preferences.locations.length === 0) return 1;

  const index = matchedPreferenceIndex(job, preferences);
  if (index >= 0) {
    return Number(
      Math.max(MIN_PREFERENCE_SCORE, TOP_PREFERENCE_SCORE - index * PREFERENCE_STEP).toFixed(4)
    );
  }

  if (job.remote) return REMOTE_LOCATION_SCORE;

  const named = job.locations.filter((location) => !LOCATION_COUNT.test(location));
  if (job.locations.length === 0 || named.length === 0) return UNKNOWN_LOCATION_SCORE;

  return NOT_WANTED_LOCATION_SCORE;
}

/** Same level, or a step up — the strongest match. Promotion is normal, and a stretch role is a real target. */
const LEVEL_FIT_BEST = 1;
/** One step below current — titles are noisy across companies, and a lateral move is real. */
const LEVEL_FIT_ONE_BELOW = 0.5;
/** Two or more steps below current — the case that actually matters: a mid-level posting for a senior candidate. */
const LEVEL_FIT_FAR_BELOW = 0.15;
/** More than one step above current — reachable deliberately via `--max-level`, so reduced rather than zeroed. */
const LEVEL_FIT_FAR_ABOVE = 0.6;

/**
 * How well a job's seniority matches the candidate's current one.
 *
 * This is the piece that actually fixes a stale declared title, and it works
 * by putting the comparison on the *job* rather than on what the candidate
 * typed into a preferences field years ago. A candidate whose LinkedIn
 * preferences still name "Web Developer" — a level roughly a fifth of what
 * they now earn — cannot have that string level-parsed and downweighted:
 * most declared titles have no seniority prefix at all ("Software Engineer",
 * "Full Stack Engineer"), so penalising an unprefixed title would punish
 * perfectly good targets along with the stale one. `current_level`, derived
 * from dated career history rather than a hand-typed list, is the one side
 * of this comparison that is actually trustworthy enough to gate on.
 *
 * `currentLevel` undefined (no parseable career history) returns neutral —
 * `rankJobs` is what decides whether to weight this component at all.
 */
export function levelFit(jobTitle: string, currentLevel: Level | undefined): number {
  if (currentLevel === undefined) return LEVEL_FIT_BEST;

  const jobLevel = titleLevel(jobTitle);
  const step = LEVELS.indexOf(jobLevel) - LEVELS.indexOf(currentLevel);

  if (step === 0 || step === 1) return LEVEL_FIT_BEST;
  if (step === -1) return LEVEL_FIT_ONE_BELOW;
  if (step <= -2) return LEVEL_FIT_FAR_BELOW;
  return LEVEL_FIT_FAR_ABOVE;
}

/** True when `value` names a level this module understands. */
export function isLevel(value: string): value is Level {
  return (LEVELS as readonly string[]).includes(value);
}

export function structuralVerdict(job: Job, criteria: StructuralCriteria): Verdict {
  const level = titleLevel(job.title);
  const rank = LEVELS.indexOf(level);

  // An unrecognised bound must not silently become a filter. `indexOf` returns
  // -1 for an unknown level, and every real level ranks above -1, so a typo in
  // `maxLevel` rejected the entire corpus and produced an empty shortlist with
  // no error. Refuse loudly instead.
  for (const [name, value] of [
    ["minLevel", criteria.minLevel],
    ["maxLevel", criteria.maxLevel],
  ] as const) {
    if (value !== undefined && !isLevel(value)) {
      throw new Error(`${name} "${value}" is not a level — expected one of ${LEVELS.join(", ")}`);
    }
  }

  if (criteria.minLevel && rank < LEVELS.indexOf(criteria.minLevel)) {
    return { keep: false, stage: "seniority", reason: `${level} is below the target level` };
  }
  if (criteria.maxLevel && rank > LEVELS.indexOf(criteria.maxLevel)) {
    return { keep: false, stage: "seniority", reason: `${level} is above the target level` };
  }

  if (!locationCompatible(job, criteria.preferences)) {
    return {
      keep: false,
      stage: "location",
      reason: `${job.locations.join(", ")} is outside the target locations`,
    };
  }

  // Only reject on employment type when the job states one and the candidate
  // named some; silence on either side is not disagreement.
  if (job.employment_type && criteria.preferences.job_types.length > 0) {
    const stated = tokens(job.employment_type);
    const wanted = criteria.preferences.job_types.some((type) => {
      const parts = normalize(type).split(" ").filter(Boolean);
      return parts.length > 0 && parts.every((part) => stated.has(part));
    });
    if (!wanted) {
      return {
        keep: false,
        stage: "employment_type",
        reason: `${job.employment_type} is not a wanted employment type`,
      };
    }
  }

  if (criteria.maxAgeDays && job.published_at) {
    const posted = new Date(job.published_at);
    if (!Number.isNaN(posted.getTime())) {
      const days = ((criteria.now ?? new Date()).getTime() - posted.getTime()) / 86_400_000;
      if (days > criteria.maxAgeDays) {
        return { keep: false, stage: "freshness", reason: `posted ${Math.round(days)} days ago` };
      }
    }
  }

  return KEEP;
}
