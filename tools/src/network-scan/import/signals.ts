import type {
  Career,
  CandidatePreferences,
  CandidateSkills,
  CompanySignals,
  SeniorityBand,
} from "../schema.js";
import { normalizationKey } from "./connections.js";
import type { CompanyGroup } from "./connections.js";
import type { ExportRow } from "./export-reader.js";
import { distinctiveTerms } from "../text-terms.js";
// `matching/` sits above `import/` in the dependency order everywhere else in
// this codebase, but `titleLevel` is a pure string->Level function with no
// dependency back on anything import-side, so pulling it in here is the
// "reuse the existing parser" the review asked for rather than a cycle.
import { titleLevel } from "../matching/structural.js";

/**
 * Non-connection signal from the rest of the LinkedIn export.
 *
 * Everything here is stated by the candidate — jobs they saved, companies they
 * follow, places they worked and studied, and the search parameters they
 * configured. None of it is inferred, so it needs no model and no Candidate
 * Profile, and it is what turns a flat company list into a ranked one.
 */

/** LinkedIn writes multi-valued preference cells as pipe-separated strings. */
function splitPipes(value: string | undefined): string[] {
  return (value ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parsePreferences(rows: ExportRow[] | undefined): CandidatePreferences {
  const row = rows?.[0];
  if (!row) {
    return { titles: [], locations: [], job_types: [], industries: [] };
  }

  const openToRecruiters = (row["Open To Recruiters"] ?? "").trim().toLowerCase();

  return {
    titles: splitPipes(row["Job Titles"]),
    locations: splitPipes(row["Locations"]),
    job_types: splitPipes(row["Preferred Job Types"]),
    industries: splitPipes(row["Industries"]),
    open_to_recruiters: openToRecruiters ? openToRecruiters === "yes" : undefined,
    urgency: (row["Job Seeking Urgency Level"] ?? "").trim() || undefined,
  };
}

/** Counts normalized company keys from one column of an export file. */
function keyCounts(rows: ExportRow[] | undefined, column: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows ?? []) {
    const key = normalizationKey(row[column] ?? "");
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export interface SignalSources {
  savedJobs?: ExportRow[];
  companyFollows?: ExportRow[];
  positions?: ExportRow[];
  education?: ExportRow[];
}

export interface BuiltSignals {
  byCompanyKey: Map<string, CompanySignals>;
  savedJobTotal: number;
  followedTotal: number;
  /** Saved-job companies with no connection in the network — out of scan scope. */
  savedJobsOutsideNetwork: number;
}

function seniorityTally(group: CompanyGroup): Record<SeniorityBand, number> {
  const tally: Record<SeniorityBand, number> = {
    leadership: 0,
    lead: 0,
    senior: 0,
    mid: 0,
    junior: 0,
    unknown: 0,
  };
  for (const connection of group.connections) {
    tally[connection.seniority] += 1;
  }
  return tally;
}

export function buildSignals(groups: CompanyGroup[], sources: SignalSources): BuiltSignals {
  const saved = keyCounts(sources.savedJobs, "Company Name");
  const followed = keyCounts(sources.companyFollows, "Organization");
  const employers = keyCounts(sources.positions, "Company Name");
  const schools = keyCounts(sources.education, "School Name");

  const byCompanyKey = new Map<string, CompanySignals>();
  for (const group of groups) {
    byCompanyKey.set(group.key, {
      connection_count: group.connections.length,
      seniority: seniorityTally(group),
      saved_job_count: saved.get(group.key) ?? 0,
      followed: followed.has(group.key),
      ex_employer: employers.has(group.key),
      alumni: schools.has(group.key),
    });
  }

  const networkKeys = new Set(groups.map((group) => group.key));
  let savedJobsOutsideNetwork = 0;
  for (const key of saved.keys()) {
    if (!networkKeys.has(key)) savedJobsOutsideNetwork += 1;
  }

  return {
    byCompanyKey,
    savedJobTotal: [...saved.values()].reduce((sum, n) => sum + n, 0),
    followedTotal: followed.size,
    savedJobsOutsideNetwork,
  };
}

/**
 * Assembles what the candidate can do from their own export.
 *
 * Skills exactly as they listed them, the titles they have held, and the
 * distinctive vocabulary of their own role descriptions. A term has to appear
 * more than once in the experience text to count, which keeps one-off words out
 * of the profile without needing a judgement about which ones matter.
 */
export function buildSkills(sources: {
  skills?: ExportRow[];
  positions?: ExportRow[];
}): CandidateSkills {
  const listed = [...new Set((sources.skills ?? []).map((row) => (row["Name"] ?? "").trim()))]
    .filter(Boolean)
    .sort();

  const heldTitles = [...new Set((sources.positions ?? []).map((row) => (row["Title"] ?? "").trim()))]
    .filter(Boolean)
    .sort();

  const counts = new Map<string, number>();
  for (const row of sources.positions ?? []) {
    for (const term of distinctiveTerms(`${row["Description"] ?? ""} ${row["Title"] ?? ""}`)) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }
  // Ordered by how often the term recurs, because consumers take the first N as
  // "the most distinctive". Sorting alphabetically and then slicing kept
  // whatever happened to start with "a" and dropped the rest, which is not what
  // the callers assume. Ties break on the term so the order stays stable.
  const experienceTerms = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .filter(([, count]) => count > 1)
    .map(([term]) => term);

  return { listed, held_titles: heldTitles, experience_terms: experienceTerms };
}

/** LinkedIn's export spells months as 3-letter abbreviations. */
const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parses LinkedIn's `"Apr 2024"` export date into a sortable month index
 * (year * 12 + month), or `null` for anything that doesn't match.
 *
 * Deliberately not `new Date(value)`: that constructor's free-form parsing is
 * engine-dependent, and handed a string it cannot make sense of, some
 * versions return an invalid date whose `getTime()` is `NaN` while others
 * guess a nearby valid one — either way, a bug elsewhere that does
 * `date.getTime() || 0` turns an unparseable date into the Unix epoch, which
 * then reads as the *oldest possible position* rather than as "unknown". A
 * dedicated parser that returns `null` and forces the caller to handle it
 * explicitly is what keeps a bad date from silently winning or losing a sort.
 */
function parseCareerDate(value: string | undefined): number | null {
  const match = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})$/.exec((value ?? "").trim());
  if (!match) return null;
  const month = MONTH_INDEX[match[1].toLowerCase()];
  return month === undefined ? null : Number(match[2]) * 12 + month;
}

/**
 * Assembles the candidate's career trajectory from `Positions.csv`.
 *
 * Separate from `CandidateSkills.held_titles`, which is an alphabetically
 * sorted *set* — useful for keyword matching, useless for recency, since it
 * makes a title held for one summer eight years ago indistinguishable from
 * the one held today. This is what lets a consumer ask "what is this person
 * doing right now" rather than "what have they ever done".
 *
 * Ordering is most-recent-start-first and fully deterministic: a position
 * whose start date does not parse is not treated as old *or* as recent — it
 * sorts after every dated position (there being no evidence either way), and
 * remaining ties break on the position's original row order in the export,
 * never on wall-clock or object identity.
 */
export function buildCareer(rows: ExportRow[] | undefined): Career {
  const parsed = (rows ?? [])
    .map((row, index) => ({
      title: (row["Title"] ?? "").trim(),
      started_on: (row["Started On"] ?? "").trim() || undefined,
      finished_on: (row["Finished On"] ?? "").trim() || undefined,
      index,
    }))
    .filter((position) => position.title)
    .map((position) => ({ ...position, startKey: parseCareerDate(position.started_on) }));

  if (parsed.length === 0) {
    return { positions: [], current_is_inferred: false };
  }

  const ordered = [...parsed].sort((a, b) => {
    if (a.startKey !== null && b.startKey !== null) return b.startKey - a.startKey;
    if (a.startKey !== null) return -1;
    if (b.startKey !== null) return 1;
    return a.index - b.index;
  });

  // A position counts as current if the export never recorded an end date —
  // true of more than one row for someone with concurrent roles. Among those,
  // the one with the latest start is the candidate's actual current title;
  // `ordered` already sorts that way, so it is simply the first open one.
  const openEnded = ordered.filter((position) => !position.finished_on);
  const current = openEnded[0] ?? ordered[0];

  return {
    positions: ordered.map((position) => ({
      title: position.title,
      started_on: position.started_on,
      finished_on: position.finished_on,
      is_current: !position.finished_on,
      level: titleLevel(position.title),
    })),
    current_title: current.title,
    current_level: titleLevel(current.title),
    // No position was open-ended, so "current" fell back to whichever one
    // started most recently rather than one the export actually marked
    // ongoing — that fallback is real information, not a rounding error.
    current_is_inferred: openEnded.length === 0,
  };
}
