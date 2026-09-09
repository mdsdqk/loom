import type { Connection, MergeReview, SeniorityBand } from "../schema.js";
import type { ExportRow } from "./export-reader.js";

/**
 * Company-name normalization and connection grouping.
 *
 * The whole pipeline downstream keys off these groups, so normalization is
 * deliberately conservative: it collapses variants that differ only by legal
 * form, parenthetical expansion, or a corporate-relationship tail, and it does
 * nothing else. Two names that merely look similar are never merged — they are
 * reported for review instead. Conflating distinct employers produces
 * confidently wrong referral targets, which is worse than leaving them split.
 */

/** Trailing legal-form tokens, stripped repeatedly from the end of a name. */
const LEGAL_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "llp",
  "ltd",
  "limited",
  "pvt",
  "private",
  "plc",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "ag",
  "sa",
  "sas",
  "bv",
  "nv",
  "ab",
  "oy",
  "pte",
  "pty",
  "srl",
  "spa",
  "sdn",
  "bhd",
]);

/**
 * Entries that name a working arrangement rather than an employer. Matched
 * against the fully normalized key, so punctuation and case are already gone.
 */
const NON_EMPLOYERS = new Set([
  "freelance",
  "freelancer",
  "self employed",
  "selfemployed",
  "stealth",
  "stealth startup",
  "stealth mode",
  "stealth mode startup",
  "student",
  "unemployed",
  "independent",
  "independent consultant",
  "retired",
  "none",
  "n a",
  "na",
  "open to work",
  "looking for opportunities",
  "seeking opportunities",
  "job seeker",
]);

/**
 * Corporate-relationship tails LinkedIn users append to a company name, e.g.
 * "Finflux - An M2P Company" and "Finflux - By M2P" both name Finflux.
 */
const RELATIONSHIP_TAIL = /\s*[-–—|,]\s*(an?|by|part of|a)\s+.*$/i;

/** Strips a trailing parenthetical, e.g. "LSEG (London Stock Exchange Group)". */
const PARENTHETICAL = /\s*\([^)]*\)/g;

/**
 * Reduces a raw company string to the key used for grouping. Two raw strings
 * that produce the same key are the same company.
 */
export function normalizationKey(raw: string): string {
  // Fold accents to their base letters first: stripping non-ASCII outright
  // would turn "Nivāsa" into "nivsa" and lose the company entirely.
  let value = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
  value = value.replace(PARENTHETICAL, " ");
  value = value.replace(RELATIONSHIP_TAIL, "");
  value = value.replace(/[^a-z0-9]+/g, " ").trim();

  let tokens = value.split(" ").filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens = tokens.slice(0, -1);
  }

  return tokens.join(" ");
}

export function isNonEmployer(raw: string): boolean {
  return NON_EMPLOYERS.has(normalizationKey(raw));
}

export function companyId(key: string): string {
  return key.replace(/\s+/g, "-");
}

const SENIORITY_PATTERNS: [SeniorityBand, RegExp][] = [
  [
    "leadership",
    /\b(ceo|cto|coo|cfo|cio|ciso|cmo|chief|founder|co-?founder|president|vice\s+president|vp|svp|evp|director|head\s+of|partner|proprietor|owner)\b/i,
  ],
  [
    "lead",
    /\b(manager|mgr|lead|leader|principal|staff|architect|supervisor|management)\b/i,
  ],
  ["senior", /\b(senior|sr|sde\s*(2|3|ii|iii)|specialist|expert)\b/i],
  [
    "junior",
    /\b(intern|internship|trainee|apprentice|fresher|junior|jr|associate|graduate|student|sde\s*(1|i))\b/i,
  ],
];

/**
 * Buckets a job title by referral weight. `lead` covers both people-management
 * and senior individual-contributor titles (principal, staff, architect) —
 * both carry comparable weight when asking for a referral.
 */
export function classifySeniority(position: string | undefined): SeniorityBand {
  const value = (position ?? "").trim();
  if (!value) return "unknown";

  for (const [band, pattern] of SENIORITY_PATTERNS) {
    if (pattern.test(value)) return band;
  }
  return "mid";
}

export interface ParsedConnections {
  connections: Connection[];
  totalRows: number;
  blankCompany: number;
  nonEmployer: number;
}

export function parseConnections(rows: ExportRow[]): ParsedConnections {
  const connections: Connection[] = [];
  let blankCompany = 0;
  let nonEmployer = 0;

  for (const row of rows) {
    const company = (row["Company"] ?? "").trim();
    if (!company) {
      blankCompany += 1;
      continue;
    }
    if (isNonEmployer(company)) {
      nonEmployer += 1;
      continue;
    }

    const name = [row["First Name"], row["Last Name"]]
      .map((part) => (part ?? "").trim())
      .filter(Boolean)
      .join(" ");
    const position = (row["Position"] ?? "").trim();

    connections.push({
      name: name || "(unnamed)",
      company_raw: company,
      position: position || undefined,
      linkedin_url: (row["URL"] ?? "").trim() || undefined,
      connected_on: (row["Connected On"] ?? "").trim() || undefined,
      seniority: classifySeniority(position),
    });
  }

  return { connections, totalRows: rows.length, blankCompany, nonEmployer };
}

export interface CompanyGroup {
  id: string;
  key: string;
  canonicalName: string;
  aliases: string[];
  connections: Connection[];
}

/**
 * Byte-order string comparison. Deliberately not `localeCompare`, which varies
 * by host locale and would make output differ between machines.
 */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Picks the display name for a group. Always a variant that actually appears in
 * the export — never a synthesized name. Preference order: most frequent, then
 * one with real capitalization over an all-lowercase entry, then byte order.
 */
function pickCanonicalName(counts: Map<string, number>): string {
  return [...counts.entries()].sort(
    (a, b) =>
      b[1] - a[1] ||
      Number(/[A-Z]/.test(b[0])) - Number(/[A-Z]/.test(a[0])) ||
      compare(a[0], b[0])
  )[0][0];
}

export function groupByCompany(connections: Connection[]): CompanyGroup[] {
  const groups = new Map<string, { connections: Connection[]; rawCounts: Map<string, number> }>();

  for (const connection of connections) {
    const key = normalizationKey(connection.company_raw);
    if (!key) continue;

    let group = groups.get(key);
    if (!group) {
      group = { connections: [], rawCounts: new Map() };
      groups.set(key, group);
    }
    group.connections.push(connection);
    group.rawCounts.set(
      connection.company_raw,
      (group.rawCounts.get(connection.company_raw) ?? 0) + 1
    );
  }

  return [...groups.entries()]
    .map(([key, group]) => ({
      id: companyId(key),
      key,
      canonicalName: pickCanonicalName(group.rawCounts),
      aliases: [...group.rawCounts.keys()].sort(compare),
      connections: group.connections,
    }))
    .sort((a, b) => b.connections.length - a.connections.length || compare(a.key, b.key));
}

/**
 * Flags company pairs where one normalized key fully prefixes another, e.g.
 * "amazon" and "amazon web services". These are reported, never merged: the
 * pair may be one employer or two, and only a human can tell.
 */
export function findMergeReviews(groups: CompanyGroup[]): MergeReview[] {
  const byFirstToken = new Map<string, CompanyGroup[]>();
  for (const group of groups) {
    const first = group.key.split(" ")[0];
    const bucket = byFirstToken.get(first);
    if (bucket) bucket.push(group);
    else byFirstToken.set(first, [group]);
  }

  const reviews: MergeReview[] = [];
  for (const bucket of byFirstToken.values()) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort((a, b) => compare(a.key, b.key));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].key.startsWith(`${sorted[i].key} `)) {
          reviews.push({
            a: sorted[i].canonicalName,
            b: sorted[j].canonicalName,
            reason: "one normalized name prefixes the other; kept separate",
          });
        }
      }
    }
  }
  return reviews;
}
