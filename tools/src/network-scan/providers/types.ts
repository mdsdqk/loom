/**
 * The provider adapter boundary.
 *
 * Adding support for a new applicant-tracking system means adding one file that
 * implements this interface and registering it — no change to discovery, job
 * fetching, normalization, or reporting. Everything provider-specific (URL
 * shapes, pagination, payload structure) lives behind here.
 */

export type ProviderId =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "workday"
  | "recruitee"
  | "workable"
  | "amazon";

/**
 * Identifies an employer's board on a provider. `id` is the board token;
 * `extra` carries anything else the provider needs to address it — Workday, for
 * example, needs a tenant, a data-centre number and a site name, none of which
 * can be guessed.
 */
export interface ProviderAccount {
  id: string;
  extra?: Record<string, string>;
}

export interface FetchSpec {
  url: string;
  method: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}

/** A job as the provider describes it, before it becomes a normalized `Job`. */
export interface RawJob {
  providerJobId?: string;
  title: string;
  locations: string[];
  remote?: boolean;
  department?: string;
  employmentType?: string;
  description?: string;
  publishedAt?: string;
  updatedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  compensation?: {
    min?: number;
    max?: number;
    currency?: string;
    interval?: string;
  };
}

/** What a `verify` call concluded about an account that was guessed, not linked. */
export interface AccountVerification {
  ok: boolean;
  /** The employer name the provider itself reports for this board, if any. */
  reportedName?: string;
  reason?: string;
}

export interface ProviderPage {
  jobs: RawJob[];
  /** True when another page should be requested. */
  hasMore: boolean;
  /** Total the provider claims, where it reports one. */
  total?: number;
}

export interface ProviderAdapter {
  readonly id: ProviderId;

  /**
   * Patterns that identify this provider inside a careers page's HTML or URL.
   * The first capture group, where present, is the account token.
   */
  readonly fingerprints: RegExp[];

  /** Turns a fingerprint match into an addressable account. */
  accountFrom(match: RegExpMatchArray, pageUrl: string): ProviderAccount | null;

  /**
   * Account tokens worth trying when no company surface links out. Guessing is
   * only ever a starting point — a guessed account must pass `verify` before
   * anything is attributed to the company.
   */
  guessAccounts?(companyName: string): ProviderAccount[];

  /** Confirms a board belongs to this employer, using the provider's own metadata. */
  verify?(account: ProviderAccount, companyName: string, fetch: FetchJson): Promise<AccountVerification>;

  /** The public endpoint for one page of postings. */
  endpoint(account: ProviderAccount, page: number): FetchSpec;

  /**
   * Turns a provider payload into jobs. Pure: no network, no clock, no
   * randomness, so every adapter is testable against a captured fixture.
   */
  normalize(payload: unknown, account: ProviderAccount): ProviderPage;
}

/** Minimal JSON fetcher handed to `verify`, so adapters never construct their own client. */
export type FetchJson = (spec: FetchSpec) => Promise<unknown | null>;

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

/**
 * Strips HTML tags and decodes the handful of entities that matter for text.
 *
 * Returns the **whole** description by default. An ingestion-time cap is pure
 * loss: the text has already been fetched, the cut cannot be undone without
 * refetching every posting, and it removes exactly the requirements and
 * qualifications sections that later matching depends on. Pass `limit` only
 * when a caller genuinely wants a snippet for display.
 */
export function toPlainText(html: string | undefined, limit?: number): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<[^>]{0,2000}>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d{1,6});/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return limit === undefined ? text : text.slice(0, limit);
}

/** Splits a provider's free-form location string into individual places. */
export function splitLocations(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\s*(?:;|\||\bor\b|\band\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 10);
}

const REMOTE_PATTERN = /\b(remote|work from home|wfh|anywhere|distributed)\b/i;

export function looksRemote(...values: (string | undefined)[]): boolean | undefined {
  const joined = values.filter(Boolean).join(" ");
  return joined ? REMOTE_PATTERN.test(joined) || undefined : undefined;
}
