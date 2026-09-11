import { createHash } from "node:crypto";
import { getAdapter } from "./providers/index.js";
import type { ProviderAccount, RawJob } from "./providers/types.js";
import { isSuccess } from "./http/client.js";
import type { HttpClient } from "./http/client.js";
import type { DescriptionRecord } from "./descriptions.js";
import type { CandidatePreferences, HiringSource, Job } from "./schema.js";

/**
 * Fetching, normalizing and deduplicating jobs from a known hiring source.
 */

/** Hard ceiling per company, so one enormous board cannot dominate a scan. */
export const DEFAULT_MAX_PAGES = 60;

/**
 * Job payloads are far larger than the careers pages the default cap was sized
 * for: a Greenhouse board fetched with full descriptions runs to many megabytes,
 * and cutting it short produced a misleading "response was not JSON".
 */
export const JOB_RESPONSE_MAX_BYTES = 24_000_000;

export interface FetchJobsResult {
  jobs: Job[];
  /** Full description text, kept out of the index — see `descriptions.ts`. */
  descriptions: DescriptionRecord[];
  error?: string;
  pages: number;
  /** The page cap was reached with more pages still available. */
  truncated: boolean;
  /** Total the provider claimed, where it reports one. */
  reportedTotal?: number;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A job's identity, in descending order of reliability:
 * provider job id, then canonical URL, then a company/title/location digest.
 *
 * Title alone is never enough — two genuinely different "Senior Software
 * Engineer" openings can exist at one company at the same time.
 */
export function jobIdentity(
  companyId: string,
  provider: string,
  raw: Pick<RawJob, "providerJobId" | "jobUrl" | "title" | "locations">
): string {
  if (raw.providerJobId) return `${provider}:${raw.providerJobId}`;

  if (raw.jobUrl) {
    try {
      const url = new URL(raw.jobUrl);
      url.hash = "";
      url.search = "";
      return `url:${url.toString().replace(/\/$/, "")}`;
    } catch {
      // Fall through to the digest.
    }
  }

  const digest = createHash("sha1")
    .update(`${companyId}|${normalizeText(raw.title)}|${normalizeText(raw.locations.join(" "))}`)
    .digest("hex")
    .slice(0, 16);
  return `digest:${digest}`;
}

/**
 * Tags a job against the candidate's own declared search parameters.
 *
 * This is a view, never a filter: the deliverable is every job at every network
 * company, and hiding rows here would quietly make that untrue. Matching is a
 * plain token overlap against what the candidate wrote on LinkedIn — no model,
 * no scoring, no ranking. Real matching is a later stage.
 */
export function matchPreferences(
  job: Pick<Job, "title" | "locations" | "remote" | "employment_type">,
  preferences: CandidatePreferences
): { matches: boolean; matchedOn: string[] } {
  const matchedOn: string[] = [];

  const titleTokens = new Set(normalizeText(job.title).split(" ").filter(Boolean));
  const titleHit = preferences.titles.find((wanted) => {
    const tokens = normalizeText(wanted).split(" ").filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => titleTokens.has(token));
  });
  if (titleHit) matchedOn.push(`title:${titleHit}`);

  // Whole-token matching, not substring: `includes` marks Indiana for "India",
  // Russia for "US", and JavaScript for "Java".
  const placeTokens = new Set(normalizeText(job.locations.join(" ")).split(" ").filter(Boolean));
  const locationHit = preferences.locations.find((wanted) => {
    const tokens = normalizeText(wanted).split(" ").filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => placeTokens.has(token));
  });
  if (locationHit) matchedOn.push(`location:${locationHit}`);
  else if (job.remote) matchedOn.push("location:remote");

  // Location is a requirement, not a bonus, once the candidate has named
  // places: a Seattle posting is not a match for someone targeting Bengaluru,
  // and treating it as one buried 150 real leads under a thousand irrelevant
  // ones. A job whose location the provider did not report cannot be ruled
  // out, so it stays in.
  //
  // Matching is literal, so a named region does not imply its cities:
  // "Europe" will not match "Berlin, Germany" without a geography table,
  // which is deliberately out of scope here.
  const locationsKnown = job.locations.length > 0;
  const locationOk =
    preferences.locations.length === 0 ||
    !locationsKnown ||
    Boolean(locationHit) ||
    Boolean(job.remote);

  if (job.employment_type) {
    const typeTokens = new Set(normalizeText(job.employment_type).split(" ").filter(Boolean));
    const typeHit = preferences.job_types.find((wanted) => {
      const tokens = normalizeText(wanted).split(" ").filter(Boolean);
      return tokens.length > 0 && tokens.every((token) => typeTokens.has(token));
    });
    if (typeHit) matchedOn.push(`type:${typeHit}`);
  }

  // A title match is necessary; location must also be compatible.
  return { matches: Boolean(titleHit) && locationOk, matchedOn };
}

export interface FetchJobsOptions {
  client: HttpClient;
  companyName: string;
  preferences: CandidatePreferences;
  maxPages?: number;
  now?: () => string;
  /** Consulted before the first request, so job fetching respects robots too. */
  robots?: { allows(url: string): Promise<boolean> };
}

/** Fetches every page of one hiring source and normalizes the result. */
export async function fetchJobsForSource(
  source: HiringSource,
  options: FetchJobsOptions
): Promise<FetchJobsResult> {
  const adapter = getAdapter(source.provider);
  if (!adapter) {
    return {
      jobs: [],
      error: `no adapter for provider "${source.provider}"`,
      pages: 0,
      truncated: false,
      descriptions: [],
    };
  }
  if (!source.account) {
    return {
      jobs: [],
      error: "hiring source has no account token",
      pages: 0,
      truncated: false,
      descriptions: [],
    };
  }

  const account: ProviderAccount = { id: source.account, extra: source.account_extra };
  const fetchedAt = (options.now ?? (() => new Date().toISOString()))();
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  if (options.robots) {
    const probe = adapter.endpoint(account, 0);
    if (!(await options.robots.allows(probe.url))) {
      return {
        jobs: [],
        error: "robots.txt disallows this endpoint",
        pages: 0,
        truncated: false,
        descriptions: [],
      };
    }
  }

  const jobs: Job[] = [];
  const descriptions: DescriptionRecord[] = [];
  const seen = new Set<string>();
  let page = 0;
  let more = false;
  let reportedTotal: number | undefined;

  while (page < maxPages) {
    const spec = adapter.endpoint(account, page);
    const result = await options.client.request({
      url: spec.url,
      method: spec.method,
      headers: spec.headers,
      body: spec.body,
      maxBytes: JOB_RESPONSE_MAX_BYTES,
    });

    if (!isSuccess(result)) {
      return {
        jobs,
        error: `${result.reason}: ${result.message}`,
        pages: page,
        truncated: false,
        reportedTotal,
        descriptions,
      };
    }
    if (result.status !== 200) {
      return {
        jobs,
        error: `HTTP ${result.status}`,
        pages: page,
        truncated: false,
        reportedTotal,
        descriptions,
      };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(result.body);
    } catch {
      // Distinguish "too big to read" from "not JSON at all" — they call for
      // completely different fixes.
      const error = result.truncated
        ? `response exceeded the ${JOB_RESPONSE_MAX_BYTES}-byte cap and was cut short`
        : "response was not JSON";
      return { jobs, error, pages: page, truncated: false, reportedTotal, descriptions };
    }

    const parsed = adapter.normalize(payload, account);
    reportedTotal = parsed.total ?? reportedTotal;
    more = parsed.hasMore;
    for (const raw of parsed.jobs) {
      const id = jobIdentity(source.company_id, adapter.id, raw);
      if (seen.has(id)) continue;
      seen.add(id);

      const job: Job = {
        id,
        company_id: source.company_id,
        company_name: options.companyName,
        title: raw.title,
        locations: raw.locations,
        remote: raw.remote,
        department: raw.department,
        employment_type: raw.employmentType,
        description_chars: raw.description?.length,
        published_at: raw.publishedAt,
        updated_at: raw.updatedAt,
        job_url: raw.jobUrl,
        apply_url: raw.applyUrl,
        compensation: raw.compensation,
        source: { provider: adapter.id, account: account.id, fetched_at: fetchedAt },
        matches_preferences: false,
        matched_on: [],
      };

      const match = matchPreferences(job, options.preferences);
      job.matches_preferences = match.matches;
      job.matched_on = match.matchedOn;

      jobs.push(job);
      if (raw.description) descriptions.push({ id, text: raw.description });
    }

    page += 1;
    if (!parsed.hasMore || parsed.jobs.length === 0) break;
  }

  // Stopping at the cap while the provider still has pages means the board was
  // cut short — the count is a floor, not the real total.
  return {
    jobs,
    pages: page,
    truncated: more && page >= maxPages,
    reportedTotal,
    descriptions,
  };
}

/**
 * Collapses jobs that appeared more than once, across sources as well as within
 * one.
 *
 * Two company records can legitimately share one board — Amazon and Amazon Web
 * Services both resolve to `amazon.jobs`, so every posting is fetched twice.
 * Which company keeps the copy must not depend on which fetch happened to
 * finish first, or the same input produces different output run to run. The
 * caller supplies a ranking (connection count, then company id) and the
 * best-ranked company wins deterministically.
 */
export function dedupeJobs(
  jobs: Job[],
  rank: (companyId: string) => number = () => 0
): { jobs: Job[]; removed: number } {
  const byId = new Map<string, Job>();
  let removed = 0;

  for (const job of jobs) {
    const existing = byId.get(job.id);
    if (!existing) {
      byId.set(job.id, job);
      continue;
    }

    removed += 1;
    const incoming = rank(job.company_id);
    const current = rank(existing.company_id);
    // Higher rank wins; ties break on company id so the result is stable.
    if (incoming > current || (incoming === current && job.company_id < existing.company_id)) {
      byId.set(job.id, job);
    }
  }

  return { jobs: [...byId.values()], removed };
}
