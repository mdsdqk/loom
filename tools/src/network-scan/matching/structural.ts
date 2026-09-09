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

  // A posting that only says how many locations it spans names none of them.
  const named = job.locations.filter((location) => !LOCATION_COUNT.test(location));
  if (named.length === 0) return true;

  const places = tokens(named.join(" "));
  return preferences.locations.some((wanted) => {
    const parts = normalize(wanted).split(" ").filter(Boolean);
    if (parts.length === 0) return false;
    return parts.every((part) => {
      const aliases = ALIAS_LOOKUP.get(part);
      return aliases ? aliases.some((alias) => places.has(alias)) : places.has(part);
    });
  });
}

export function structuralVerdict(job: Job, criteria: StructuralCriteria): Verdict {
  const level = titleLevel(job.title);
  const rank = LEVELS.indexOf(level);

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
