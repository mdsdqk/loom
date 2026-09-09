import type {
  CandidatePreferences,
  CandidateSkills,
  CompanySignals,
  SeniorityBand,
} from "../schema.js";
import { normalizationKey } from "./connections.js";
import type { CompanyGroup } from "./connections.js";
import type { ExportRow } from "./export-reader.js";

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
 * Words too common in job and profile text to distinguish anything. Matching on
 * them would score every job against every candidate.
 */
const STOPWORDS = new Set([
  "and", "the", "for", "with", "our", "you", "your", "are", "will", "team", "work", "working",
  "experience", "years", "role", "job", "position", "company", "business", "new", "using", "use",
  "including", "across", "within", "strong", "good", "great", "ability", "skills", "knowledge",
  "development", "developing", "build", "building", "built", "help", "support", "ensure", "manage",
  "based", "well", "have", "has", "been", "this", "that", "from", "into", "other", "more", "who",
  "what", "when", "how", "all", "any", "can", "not", "was", "were", "they", "them", "their",
]);

/** Splits free text into distinctive lowercase terms. */
function termsFrom(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    // Keep the punctuation that carries meaning in technology names.
    .replace(/[^a-z0-9+#./ -]+/g, " ")
    .split(/[\s,/]+/)
    .map((term) => term.replace(/^[-.]+|[-.]+$/g, ""))
    .filter((term) => term.length > 2 && term.length < 32 && !STOPWORDS.has(term));
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
    for (const term of termsFrom(`${row["Description"] ?? ""} ${row["Title"] ?? ""}`)) {
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
