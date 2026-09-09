import { normalizationKey } from "../import/connections.js";
import type { ExportRow } from "../import/export-reader.js";
import type { Job } from "../schema.js";

/**
 * Measuring a matcher against jobs the candidate actually wanted.
 *
 * A scoring function tuned by eye always looks reasonable, because the person
 * tuning it is also the person judging it. The LinkedIn export contains jobs the
 * candidate saved of their own accord — real positive labels, produced before
 * any of this existed and without being asked. Checking a matcher against those
 * is the difference between a threshold that was measured and one that was
 * guessed.
 *
 * The limits are worth stating plainly, because this evidence is weaker than it
 * looks:
 *   - the labels are positive-only, so this can show a matcher misses good jobs
 *     but says nothing about how much rubbish it lets through;
 *   - there are few of them, so small differences mean nothing;
 *   - they are biased toward whatever the candidate happened to browse;
 *   - a saved job is interest, not a good match — people save jobs they later
 *     dismiss.
 *
 * So: this can demonstrate a matcher is bad. It cannot prove one is good.
 */

export interface SavedJob {
  title: string;
  company: string;
  /** Normalized company name, for matching against scanned companies. */
  companyKey: string;
  url?: string;
  savedOn?: string;
}

export function parseSavedJobs(rows: ExportRow[] | undefined): SavedJob[] {
  return (rows ?? [])
    .map((row) => ({
      title: (row["Job Title"] ?? "").trim(),
      company: (row["Company Name"] ?? "").trim(),
      companyKey: normalizationKey(row["Company Name"] ?? ""),
      url: (row["Job Url"] ?? "").trim() || undefined,
      savedOn: (row["Saved Date"] ?? "").trim() || undefined,
    }))
    .filter((saved) => saved.title && saved.company);
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Whether a scanned job is plausibly the posting the candidate saved.
 *
 * Saved titles come from LinkedIn and scanned titles from the employer's own
 * board, so they rarely match character for character. Every word of the
 * **saved** title must appear in the scanned one — that tolerates the suffixes
 * boards add ("(Remote)", a requisition code, a team name) while refusing the
 * reverse.
 *
 * The direction matters. Allowing the shorter title to be the subset let a
 * scanned "Product Developer" match a saved "Lead Product Developer - Angular
 * JS", and since that unrelated role was in the wrong city the harness reported
 * a miss the matcher had not made. A false match corrupts the measurement in
 * both directions; a missed match only shrinks the sample, which is the safer
 * failure for something whose whole job is to be trusted.
 */
export function isSameRole(savedTitle: string, jobTitle: string): boolean {
  const saved = normalizeTitle(savedTitle).split(" ").filter(Boolean);
  if (saved.length === 0) return false;

  const scanned = new Set(normalizeTitle(jobTitle).split(" ").filter(Boolean));
  return saved.every((word) => scanned.has(word));
}

export interface CalibrationResult {
  /** Saved jobs whose company the scan reached at all. */
  reachable: number;
  /** Saved jobs found among the scanned postings. */
  found: number;
  /** Of those found, how many the matcher kept. */
  kept: number;
  /** Saved jobs the matcher discarded, with the stage that discarded them. */
  missed: { title: string; company: string; rejectedBy: string }[];
  /** Saved jobs at companies the scan never retrieved — a coverage gap, not a matcher fault. */
  unreachable: { title: string; company: string }[];
}

/**
 * Runs a candidate matcher over the saved jobs and reports what it would drop.
 *
 * `decide` returns the stage that rejected a job, or null to keep it — the same
 * shape the tiered funnel produces, so a matcher can be measured without being
 * rewritten for the test.
 */
export function calibrate(
  saved: SavedJob[],
  scanned: Job[],
  decide: (job: Job) => string | null
): CalibrationResult {
  const scannedCompanies = new Set(scanned.map((job) => normalizationKey(job.company_name)));

  const result: CalibrationResult = {
    reachable: 0,
    found: 0,
    kept: 0,
    missed: [],
    unreachable: [],
  };

  for (const target of saved) {
    if (!scannedCompanies.has(target.companyKey)) {
      result.unreachable.push({ title: target.title, company: target.company });
      continue;
    }
    result.reachable += 1;

    // A saved job names a *role at a company*, and employers list one role in
    // many cities. Every posting of it must be considered: taking only the
    // first match reported a saved Okta role as lost because the first of its
    // 19 postings happened to be in Toronto, while twelve were in the
    // candidate's own city and passed cleanly.
    const matches = scanned.filter(
      (job) =>
        normalizationKey(job.company_name) === target.companyKey &&
        isSameRole(target.title, job.title)
    );
    // The role may simply have been filled and taken down since it was saved.
    if (matches.length === 0) continue;

    result.found += 1;

    const verdicts = matches.map((job) => decide(job));
    if (verdicts.some((rejectedBy) => rejectedBy === null)) {
      result.kept += 1;
    } else {
      // Report the most common reason, so the summary points at the real cause
      // rather than whichever posting happened to sort first.
      const counts = new Map<string, number>();
      for (const reason of verdicts) {
        if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
      }
      const rejectedBy = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
      result.missed.push({ title: target.title, company: target.company, rejectedBy });
    }
  }

  return result;
}

/** Human-readable summary, including the caveats, so the number is not read as more than it is. */
export function formatCalibration(result: CalibrationResult): string {
  const recall =
    result.found === 0 ? "n/a" : `${Math.round((result.kept / result.found) * 100)}%`;

  const lines = [
    "Calibration against jobs you saved yourself",
    "",
    `  saved jobs at companies the scan reached:  ${result.reachable}`,
    `  of those, still listed and found:          ${result.found}`,
    `  kept by the matcher:                       ${result.kept}  (recall ${recall})`,
    `  discarded by the matcher:                  ${result.missed.length}`,
    `  at companies the scan never reached:       ${result.unreachable.length}`,
  ];

  if (result.missed.length > 0) {
    lines.push("", "  Discarded — each one is a job you wanted and the matcher rejected:");
    for (const miss of result.missed) {
      lines.push(`    ${miss.company} — ${miss.title}  (${miss.rejectedBy})`);
    }
  }

  lines.push(
    "",
    "  These labels are positive-only and few, so this can show the matcher is",
    "  too aggressive. It cannot show it is precise.",
  );

  return lines.join("\n");
}
