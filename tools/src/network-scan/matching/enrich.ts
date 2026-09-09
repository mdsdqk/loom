import { isSuccess } from "../http/client.js";
import type { HttpClient } from "../http/client.js";
import { toPlainText } from "../providers/types.js";
import type { Job } from "../schema.js";

/**
 * Tier 2.5 — fetch the descriptions the list endpoints did not return.
 *
 * Not a filter. This is the expensive stage the cheap tiers exist to protect:
 * Workday's list endpoint returns a title, a location and a path, so its 9,684
 * postings carry no text at all. Running this before the cheap passes would
 * mean ten thousand requests; running it after means hundreds.
 *
 * Only Workday needs it today, and only because its API is shaped that way.
 * Other providers already return their text in the list response.
 */

/** Providers whose list endpoint omits the description. */
const NEEDS_DETAIL_FETCH = new Set(["workday"]);

export function needsDescription(job: Job, known: Map<string, string>): boolean {
  if (known.has(job.id)) return false;
  if (!job.job_url) return false;
  return NEEDS_DETAIL_FETCH.has(job.source.provider);
}

/**
 * Turns a Workday careers URL into its JSON detail endpoint.
 *
 * The public site and its API are the same data behind different paths:
 *   https://{tenant}.{dc}.myworkdayjobs.com/{site}/job/{...}
 *   https://{tenant}.{dc}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/job/{...}
 */
export function workdayDetailUrl(jobUrl: string): string | null {
  const match = /^https:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/([^/]+)\/(.+)$/i.exec(jobUrl);
  if (!match) return null;
  const [, tenant, dc, site, rest] = match;
  return `https://${tenant}.${dc}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/${rest}`;
}

export interface EnrichResult {
  id: string;
  text?: string;
  error?: string;
}

/** Fetches one job's description. Returns an error rather than throwing. */
export async function fetchDescription(job: Job, client: HttpClient): Promise<EnrichResult> {
  if (!job.job_url) return { id: job.id, error: "job has no URL" };

  const detailUrl = workdayDetailUrl(job.job_url);
  if (!detailUrl) return { id: job.id, error: "no detail endpoint for this URL" };

  const result = await client.request({
    url: detailUrl,
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!isSuccess(result)) return { id: job.id, error: `${result.reason}: ${result.message}` };
  if (result.status !== 200) return { id: job.id, error: `HTTP ${result.status}` };

  let payload: unknown;
  try {
    payload = JSON.parse(result.body);
  } catch {
    return { id: job.id, error: "detail response was not JSON" };
  }

  const posting = (payload as { jobPostingInfo?: { jobDescription?: unknown } })?.jobPostingInfo;
  const text = toPlainText(
    typeof posting?.jobDescription === "string" ? posting.jobDescription : undefined
  );

  return text ? { id: job.id, text } : { id: job.id, error: "detail response carried no description" };
}
