/**
 * Tier 2 — what kind of job is this, from the title alone.
 *
 * The largest single cut in the funnel and the cheapest: on a real corpus a
 * plain discipline test on titles keeps 27% and rejects 11,637 of 16,156 jobs
 * before a single description is fetched.
 *
 * Deliberately a lookup rather than a model. Most titles are unambiguous, a
 * table can be read and argued with, and it costs nothing to run over the whole
 * corpus. Titles that a table genuinely cannot settle — "Solutions Architect",
 * "Applied Scientist" — are reported as `ambiguous` rather than guessed at, so
 * a later model pass can be pointed at exactly those and nothing else.
 *
 * Caching helps less here than instinct suggests: the same corpus held 12,487
 * distinct titles across 16,156 jobs.
 */

export type Family =
  | "engineering"
  | "data"
  | "product"
  | "design"
  | "finance"
  | "legal"
  | "sales"
  | "marketing"
  | "people"
  | "operations"
  | "support"
  | "research"
  | "medical"
  | "trades"
  | "ambiguous"
  | "unknown";

/** Every family name, for validating user input against a real list. */
export const FAMILY_NAMES: Family[] = [
  "engineering", "data", "product", "design", "finance", "legal", "sales",
  "marketing", "people", "operations", "support", "research", "medical", "trades",
];

/**
 * Titles that read as engineering to a keyword test but are not a software
 * engineering role. Checked first, because "Engineering Operation Technician"
 * and "Sales Engineer" both contain "engineer".
 */
const DISQUALIFIERS: [Family, RegExp][] = [
  ["trades", /\b(technician|installer|electrician|mechanic|welder|machinist|maintenance|facilities|janitor|driver|warehouse|forklift)\b/i],
  ["sales", /\b(sales engineer|pre-?sales|account executive|business development|partner manager|customer success)\b/i],
  ["support", /\b(support engineer|help ?desk|service desk|desktop support|field engineer)\b/i],
  ["medical", /\b(nurse|physician|clinical|pharmac|therapist|radiolog|dental)\b/i],
];

/** Ordered: the first family whose pattern matches wins. */
const FAMILIES: [Family, RegExp][] = [
  [
    // Checked before `research` so that a machine-learning *engineer* is not
    // filed as a scientist and rejected outright — those are jobs a software
    // engineer applies to.
    "engineering",
    /\b(software engineer|software developer|sde|swe|programmer|full ?stack|front ?end|back ?end|web engineer|mobile engineer|android|ios engineer|devops|site reliability|sre|platform engineer|infrastructure engineer|security engineer|qa engineer|test engineer|automation engineer|embedded|firmware|systems engineer|cloud engineer|engineering manager|machine learning engineer|ml engineer|ai engineer|data engineer)\b/i,
  ],
  [
    // A bare "developer" is engineering only when nothing qualifies it into
    // another discipline: "Business Developer" is a sales role.
    "engineering",
    /(?<!\b(?:business|market|land|property|real estate)\s)\bdevelopers?\b/i,
  ],
  [
    "data",
    /\b(data analyst|analytics engineer|business intelligence|bi developer|database administrator|dba|data warehouse|etl)\b/i,
  ],
  ["product", /\b(product manager|product owner|program manager|technical program|tpm|scrum master)\b/i],
  ["design", /\b(designer|ux|ui designer|user experience|user research|creative director)\b/i],
  ["finance", /\b(accountant|accounting|controller|auditor|financial analyst|finance manager|treasury|payroll|tax|bookkeep|actuar)\b/i],
  ["legal", /\b(counsel|attorney|paralegal|legal|compliance officer|contracts manager)\b/i],
  ["sales", /\b(sales|account manager|business development|revenue|quota)\b/i],
  ["marketing", /\b(marketing|brand|content strategist|seo|social media|communications|public relations|copywriter)\b/i],
  ["people", /\b(recruiter|talent acquisition|human resources|\bhr\b|people operations|people partner|compensation|benefits)\b/i],
  ["operations", /\b(operations|logistics|supply chain|procurement|fulfillment|warehouse manager|store manager|barista|cashier|associate - retail)\b/i],
  ["support", /\b(customer service|customer support|call ?cent|technical support)\b/i],
  // Scientists, not engineers — ML/AI engineering is matched above.
  ["research", /\b(research scientist|applied scientist|research engineer|scientist)\b/i],
];

/**
 * Titles that could reasonably belong to more than one family. Reported rather
 * than forced, so a model pass can be pointed at exactly these.
 */
const AMBIGUOUS = /\b(solutions architect|solution architect|technical consultant|consultant|specialist|analyst|architect|technical account|associate|engineer)\b/i;

export interface Classification {
  family: Family;
  /** What in the title decided it, so a wrong answer can be traced. */
  evidence?: string;
}

/**
 * Titles are punctuated inconsistently across boards: "Front-End Engineer",
 * "Front End Engineer" and "Frontend Engineer" are one job. Without folding
 * separators, the hyphenated spelling missed every engineering pattern, fell
 * through to `ambiguous`, and was then ranked below its identical twin.
 */
export function foldSeparators(title: string): string {
  return title.replace(/[-_/]+/g, " ").replace(/\s+/g, " ");
}

export function classifyTitle(title: string): Classification {
  const folded = foldSeparators(title);

  for (const [family, pattern] of DISQUALIFIERS) {
    const match = pattern.exec(folded);
    if (match) return { family, evidence: match[0] };
  }

  for (const [family, pattern] of FAMILIES) {
    const match = pattern.exec(folded);
    if (match) return { family, evidence: match[0] };
  }

  const ambiguous = AMBIGUOUS.exec(folded);
  if (ambiguous) return { family: "ambiguous", evidence: ambiguous[0] };

  return { family: "unknown" };
}

export interface FamilyCriteria {
  /** Families the candidate works in. */
  wanted: Family[];
  /**
   * Whether to keep titles the table could not settle. Keeping them is the
   * safe default: an ambiguous title costs one description fetch, while
   * discarding it may silently drop the right job.
   */
  keepAmbiguous?: boolean;
  /** Same question for titles that matched nothing at all. */
  keepUnknown?: boolean;
}

export interface FamilyVerdict {
  keep: boolean;
  family: Family;
  evidence?: string;
  reason?: string;
  /** True when a model pass should decide this one. */
  needsReview: boolean;
}

export function familyVerdict(title: string, criteria: FamilyCriteria): FamilyVerdict {
  const { family, evidence } = classifyTitle(title);

  if (family === "ambiguous") {
    const keep = criteria.keepAmbiguous ?? true;
    return {
      keep,
      family,
      evidence,
      needsReview: keep,
      reason: keep ? undefined : "title too ambiguous to place",
    };
  }

  if (family === "unknown") {
    const keep = criteria.keepUnknown ?? true;
    return {
      keep,
      family,
      needsReview: keep,
      reason: keep ? undefined : "title matched no known discipline",
    };
  }

  const keep = criteria.wanted.includes(family);
  return {
    keep,
    family,
    evidence,
    needsReview: false,
    reason: keep ? undefined : `${family} is not a discipline you work in`,
  };
}
