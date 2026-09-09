import { z } from "zod";

/**
 * Runtime schema + inferred types for the Network Scan pipeline artifacts.
 *
 * Each pipeline stage reads and writes one of these YAML documents, so every
 * stage is independently re-runnable and its output is diffable. This file
 * covers stage 1 (`network-import`) plus the shared vocabulary later stages
 * build on.
 */

/**
 * How a connection's job title reads in terms of referral weight. `lead` covers
 * both people-management and senior individual-contributor titles (principal,
 * staff, architect), which carry comparable weight when asking for a referral.
 */
export const SeniorityBandSchema = z.enum([
  "leadership",
  "lead",
  "senior",
  "mid",
  "junior",
  "unknown",
]);

export const ConnectionSchema = z.object({
  name: z.string().min(1),
  /** The company string exactly as LinkedIn exported it. */
  company_raw: z.string().min(1),
  position: z.string().optional(),
  linkedin_url: z.string().optional(),
  connected_on: z.string().optional(),
  seniority: SeniorityBandSchema,
});

/**
 * Deterministic, non-inferred signals about a company, assembled from the
 * candidate's own export. Every field traces to a file in the export — none of
 * it is guessed or scored by a model.
 */
export const CompanySignalsSchema = z.object({
  connection_count: z.number().int().nonnegative(),
  /** Connections per seniority band, for referral-strength reading. */
  seniority: z.record(SeniorityBandSchema, z.number().int().nonnegative()),
  /** Jobs the candidate saved at this company (Jobs/Saved Jobs.csv). */
  saved_job_count: z.number().int().nonnegative(),
  /** The candidate follows this company (Company Follows.csv). */
  followed: z.boolean(),
  /** The candidate worked here (Positions.csv) — ex-colleagues. */
  ex_employer: z.boolean(),
  /** The candidate studied here (Education.csv) — alumni overlap. */
  alumni: z.boolean(),
});

export const CompanySchema = z.object({
  /** Stable slug derived from the normalization key. */
  id: z.string().min(1),
  canonical_name: z.string().min(1),
  /** Every distinct raw export string that grouped into this company. */
  aliases: z.array(z.string()).default([]),
  signals: CompanySignalsSchema,
  connections: z.array(ConnectionSchema).default([]),
});

/**
 * The candidate's own declared job-search parameters, read verbatim from
 * `Jobs/Job Seeker Preferences.csv`. This is candidate-authored, so it needs no
 * inference and no Candidate Profile dependency.
 */
export const CandidatePreferencesSchema = z.object({
  titles: z.array(z.string()).default([]),
  locations: z.array(z.string()).default([]),
  job_types: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([]),
  open_to_recruiters: z.boolean().optional(),
  urgency: z.string().optional(),
});

/**
 * A pair of company names that normalized close to each other but not
 * identically. Surfaced for a human to look at rather than merged silently —
 * merging on fuzzy similarity alone is how distinct employers get conflated.
 */
export const MergeReviewSchema = z.object({
  a: z.string().min(1),
  b: z.string().min(1),
  reason: z.string().min(1),
});

export const ImportCountsSchema = z.object({
  connection_rows: z.number().int().nonnegative(),
  connections_with_company: z.number().int().nonnegative(),
  companies: z.number().int().nonnegative(),
  dropped_non_employer: z.number().int().nonnegative(),
  dropped_blank_company: z.number().int().nonnegative(),
  saved_jobs: z.number().int().nonnegative(),
  followed_orgs: z.number().int().nonnegative(),
});

export const NetworkImportSchema = z.object({
  /** Basename of the export directory the import read. */
  source: z.string().min(1),
  imported_at: z.string().min(1),
  counts: ImportCountsSchema,
  preferences: CandidatePreferencesSchema,
  companies: z.array(CompanySchema).default([]),
  review: z.array(MergeReviewSchema).default([]),
  /** Files the importer expected but did not find, by basename. */
  missing_files: z.array(z.string()).default([]),
});

/** One candidate domain tried during resolution, and why it did or didn't work. */
export const DomainAttemptSchema = z.object({
  domain: z.string().min(1),
  outcome: z.string().min(1),
  /** The page's title, kept when a candidate was rejected for naming someone else. */
  title: z.string().optional(),
});

export const CompanyDomainSchema = z.object({
  company_id: z.string().min(1),
  /** Present only when `status` is `verified` — nothing downstream may guess. */
  domain: z.string().optional(),
  status: z.enum(["verified", "unresolved"]),
  method: z.enum(["registry", "guess_verified", "none"]),
  confidence: z.number().min(0).max(1),
  /** Which identity signal carried the match (og:site_name, title, ...). */
  matched_on: z.string().optional(),
  /** The company name is too short to identify reliably; treat with suspicion. */
  weak_name: z.boolean(),
  /** Only part of the name matched — may be a parent company, not the employer. */
  partial_name: z.boolean().default(false),
  attempts: z.array(DomainAttemptSchema).default([]),
});

export const DomainCountsSchema = z.object({
  companies: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
  from_registry: z.number().int().nonnegative(),
  unresolved: z.number().int().nonnegative(),
  weak_name: z.number().int().nonnegative(),
  partial_name: z.number().int().nonnegative(),
  low_confidence: z.number().int().nonnegative(),
  /** Unresolved companies grouped by the reason their last candidate failed. */
  unresolved_reasons: z.record(z.string(), z.number().int().nonnegative()),
});

export const DomainsArtifactSchema = z.object({
  source: z.string().min(1),
  resolved_at: z.string().min(1),
  counts: DomainCountsSchema,
  http: z.object({
    requests: z.number().int().nonnegative(),
    cache_hits: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
  }),
  domains: z.array(CompanyDomainSchema).default([]),
});

/** How a hiring source was found, in descending order of trustworthiness. */
export const DiscoveryMethodSchema = z.enum([
  "registry",
  "sitemap",
  "homepage",
  "common_path",
  "guess_verified",
]);

export const HiringSourceSchema = z.object({
  company_id: z.string().min(1),
  company_domain: z.string().optional(),
  careers_url: z.string().optional(),
  /** Adapter id, an `unsupported:*` marker, or "unknown". */
  provider: z.string(),
  /** Board token; Workday-style providers carry tenant/site in `account_extra`. */
  account: z.string().optional(),
  account_extra: z.record(z.string(), z.string()).optional(),
  discovery_method: DiscoveryMethodSchema.optional(),
  confidence: z.number().min(0).max(1),
  status: z.enum(["active", "unsupported", "no_provider", "no_careers_page", "failed"]),
  /** What the provider itself said this board's employer is, when it says so. */
  verified_name: z.string().optional(),
  note: z.string().optional(),
});

export const HiringSourcesArtifactSchema = z.object({
  source: z.string().min(1),
  discovered_at: z.string().min(1),
  counts: z.object({
    companies: z.number().int().nonnegative(),
    careers_page_found: z.number().int().nonnegative(),
    provider_detected: z.number().int().nonnegative(),
    unsupported_provider: z.number().int().nonnegative(),
    no_provider: z.number().int().nonnegative(),
    no_careers_page: z.number().int().nonnegative(),
    by_provider: z.record(z.string(), z.number().int().nonnegative()),
  }),
  http: z.object({
    requests: z.number().int().nonnegative(),
    cache_hits: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
  }),
  sources: z.array(HiringSourceSchema).default([]),
});

export const CompensationSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  currency: z.string().optional(),
  interval: z.string().optional(),
});

export const JobSchema = z.object({
  /** Stable identity: provider + provider job id, else canonical URL, else a title/location digest. */
  id: z.string().min(1),
  company_id: z.string().min(1),
  company_name: z.string().min(1),
  title: z.string().min(1),
  locations: z.array(z.string()).default([]),
  remote: z.boolean().optional(),
  department: z.string().optional(),
  employment_type: z.string().optional(),
  /**
   * Length of the full description, which lives in the `descriptions.jsonl`
   * sidecar keyed by this job's id — see `descriptions.ts` for why.
   */
  description_chars: z.number().int().nonnegative().optional(),
  published_at: z.string().optional(),
  updated_at: z.string().optional(),
  job_url: z.string().optional(),
  apply_url: z.string().optional(),
  compensation: CompensationSchema.optional(),
  source: z.object({
    provider: z.string(),
    account: z.string().optional(),
    fetched_at: z.string(),
  }),
  /**
   * Whether the job matches the candidate's own declared search parameters.
   * A view, not a filter — every job is kept regardless.
   */
  matches_preferences: z.boolean().default(false),
  matched_on: z.array(z.string()).default([]),
});

export const ScanFailureSchema = z.object({
  company_id: z.string().optional(),
  stage: z.enum([
    "parse",
    "company_resolution",
    "domain_discovery",
    "career_discovery",
    "provider_detection",
    "job_fetch",
  ]),
  error: z.string(),
  retryable: z.boolean(),
});

export const JobsArtifactSchema = z.object({
  source: z.string().min(1),
  fetched_at: z.string().min(1),
  counts: z.object({
    sources_attempted: z.number().int().nonnegative(),
    sources_succeeded: z.number().int().nonnegative(),
    /** Boards cut short by the page cap; their job counts are floors. */
    sources_truncated: z.number().int().nonnegative().default(0),
    jobs_before_dedupe: z.number().int().nonnegative(),
    jobs: z.number().int().nonnegative(),
    duplicates_removed: z.number().int().nonnegative(),
    matching_preferences: z.number().int().nonnegative(),
    by_provider: z.record(z.string(), z.number().int().nonnegative()),
  }),
  http: z.object({
    requests: z.number().int().nonnegative(),
    cache_hits: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
  }),
  failures: z.array(ScanFailureSchema).default([]),
  jobs: z.array(JobSchema).default([]),
});

export type DiscoveryMethod = z.infer<typeof DiscoveryMethodSchema>;
export type HiringSource = z.infer<typeof HiringSourceSchema>;
export type HiringSourcesArtifact = z.infer<typeof HiringSourcesArtifactSchema>;
export type Job = z.infer<typeof JobSchema>;
export type ScanFailure = z.infer<typeof ScanFailureSchema>;
export type JobsArtifact = z.infer<typeof JobsArtifactSchema>;

export type SeniorityBand = z.infer<typeof SeniorityBandSchema>;
export type DomainAttempt = z.infer<typeof DomainAttemptSchema>;
export type CompanyDomain = z.infer<typeof CompanyDomainSchema>;
export type DomainCounts = z.infer<typeof DomainCountsSchema>;
export type DomainsArtifact = z.infer<typeof DomainsArtifactSchema>;
export type Connection = z.infer<typeof ConnectionSchema>;
export type CompanySignals = z.infer<typeof CompanySignalsSchema>;
export type Company = z.infer<typeof CompanySchema>;
export type CandidatePreferences = z.infer<typeof CandidatePreferencesSchema>;
export type MergeReview = z.infer<typeof MergeReviewSchema>;
export type ImportCounts = z.infer<typeof ImportCountsSchema>;
export type NetworkImport = z.infer<typeof NetworkImportSchema>;
