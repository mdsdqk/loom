import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface CompanyAndTitle {
  company: string;
  title: string;
}

/**
 * Deterministic heuristics for pulling a company name and job title out of
 * a JD's markdown text. Tries, in order:
 *   1. Labeled lines: "Company: X" / "Employer: X", "Title|Role|Position: X"
 *   2. The first heading, split on " at " / " - " / " — " / "|" into title/company
 * Throws if neither yields both fields — callers should require explicit
 * --company/--role overrides in that case rather than guessing.
 */
export function extractCompanyAndTitle(jdText: string): CompanyAndTitle {
  const companyLabelMatch = jdText.match(/^\s*(?:company|employer)\s*[:-]\s*(.+)$/im);
  const titleLabelMatch = jdText.match(/^\s*(?:job title|title|role|position)\s*[:-]\s*(.+)$/im);

  let company = companyLabelMatch?.[1]?.trim();
  let title = titleLabelMatch?.[1]?.trim();

  if (!company || !title) {
    const headingMatch = jdText.match(/^\s{0,3}#{1,6}\s*(.+)$/m);
    const heading = headingMatch?.[1]?.trim();
    if (heading) {
      const separators = [" at ", " — ", " – ", " - ", "|"];
      for (const separator of separators) {
        if (heading.includes(separator)) {
          const [left, right] = heading.split(separator).map((part) => part.trim());
          if (left && right) {
            if (separator === " at ") {
              title = title ?? left;
              company = company ?? right;
            } else {
              company = company ?? left;
              title = title ?? right;
            }
          }
          break;
        }
      }
    }
  }

  if (!company || !title) {
    throw new Error(
      "Could not determine company and job title from the JD. Pass --company and --role explicitly."
    );
  }

  return { company, title };
}

/**
 * Deterministic heuristic for a job/requisition ID, from a labeled line
 * ("Job ID: X" / "Req ID: X" / "Requisition ID: X" / "Posting ID: X" /
 * "Reference: X"). Returns undefined rather than guessing if no such line
 * is present.
 */
export function extractJobId(jdText: string): string | undefined {
  const match = jdText.match(/^\s*(?:job id|req(?:uisition)? id|posting id|reference)\s*[:-]\s*(.+)$/im);
  return match?.[1]?.trim() || undefined;
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** Normalizes a date string to YYYY-MM-DD if it matches a recognized, unambiguous format; otherwise returns undefined rather than guessing. */
export function normalizeDate(raw: string): string | undefined {
  const trimmed = raw.trim();

  const iso = trimmed.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const monthPattern = MONTH_NAMES.join("|");
  const monthDayYear = trimmed.match(new RegExp(`^(${monthPattern})\\s+(\\d{1,2}),?\\s+(\\d{4})$`, "i"));
  if (monthDayYear) {
    const month = MONTH_NAMES.indexOf(monthDayYear[1].toLowerCase()) + 1;
    const day = monthDayYear[2].padStart(2, "0");
    return `${monthDayYear[3]}-${String(month).padStart(2, "0")}-${day}`;
  }

  const dayMonthYear = trimmed.match(new RegExp(`^(\\d{1,2})\\s+(${monthPattern}),?\\s+(\\d{4})$`, "i"));
  if (dayMonthYear) {
    const month = MONTH_NAMES.indexOf(dayMonthYear[2].toLowerCase()) + 1;
    const day = dayMonthYear[1].padStart(2, "0");
    return `${dayMonthYear[3]}-${String(month).padStart(2, "0")}-${day}`;
  }

  return undefined;
}

/**
 * Deterministic heuristic for a posting date, from a labeled line
 * ("Posted: X" / "Posting Date: X" / "Date Posted: X" / "Published: X").
 * Only recognized, unambiguous date formats (ISO, "Month D, YYYY", "D Month
 * YYYY") are accepted — anything else is treated as not found rather than
 * guessed at.
 */
export function extractPostingDate(jdText: string): string | undefined {
  const match = jdText.match(/^\s*(?:posted|posting date|date posted|published)\s*[:-]\s*(.+)$/im);
  const raw = match?.[1]?.trim();
  return raw ? normalizeDate(raw) : undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export interface CreateOpportunityOptions {
  masterResumePath: string;
  jdPath: string;
  opportunitiesRoot: string;
  company?: string;
  role?: string;
  jobId?: string;
  postedDate?: string;
}

export interface CreateOpportunityResult {
  slug: string;
  opportunityDir: string;
  artifactsDir: string;
  company: string;
  title: string;
  jobId?: string;
  postedDate?: string;
}

/**
 * Builds the opportunity slug: `<company>-<title>` disambiguated by, in
 * priority order, an explicit job/requisition ID, then a posting date, then
 * nothing (company+title alone is the final fallback).
 */
export function buildSlug(company: string, title: string, jobId?: string, postedDate?: string): string {
  const base = slugify(`${company} ${title}`);
  const disambiguator = jobId ?? postedDate;
  return disambiguator ? `${base}-${slugify(disambiguator)}` : base;
}

/** Creates opportunities/<slug>/artifacts/{jd.md,resume.yml} from a JD and master resume. Never overwrites an existing opportunity directory. */
export async function createOpportunity(
  options: CreateOpportunityOptions
): Promise<CreateOpportunityResult> {
  const jdText = await readFile(options.jdPath, "utf8");

  const { company, title } =
    options.company && options.role
      ? { company: options.company, title: options.role }
      : extractCompanyAndTitle(jdText);

  const jobId = options.jobId ?? extractJobId(jdText);
  const postedDate = options.postedDate ?? extractPostingDate(jdText);

  const slug = buildSlug(company, title, jobId, postedDate);
  if (!slug) {
    throw new Error(`Determined company "${company}" and role "${title}" produced an empty slug.`);
  }

  const opportunityDir = join(options.opportunitiesRoot, slug);
  const artifactsDir = join(opportunityDir, "artifacts");

  if (await pathExists(opportunityDir)) {
    throw new Error(`Opportunity directory already exists: ${opportunityDir}`);
  }

  /*
   * Everything after the mkdir can fail: a master resume path that does not
   * exist, a full disk. Leaving the directory behind would make the retry look
   * like a duplicate, and the only way out would be deleting the folder by
   * hand. Since the directory did not exist a moment ago, removing it is safe.
   */
  await mkdir(artifactsDir, { recursive: true });
  try {
    await copyFile(options.jdPath, join(artifactsDir, "jd.md"));
    await copyFile(options.masterResumePath, join(artifactsDir, "resume.yml"));
    await writeFile(
      join(opportunityDir, "meta.yml"),
      stringify({ company, role: title, job_id: jobId, posted_date: postedDate }),
      "utf8"
    );
  } catch (error) {
    await rm(opportunityDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  return { slug, opportunityDir, artifactsDir, company, title, jobId, postedDate };
}
