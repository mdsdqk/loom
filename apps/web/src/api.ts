import type {
  EventState,
  Referral,
  Source,
  LoomConfig,
  Opportunity,
  Outcome,
  Status,
  StatusEvent,
} from "@loom/tools";

export type { EventState, LoomConfig, Opportunity, Outcome, Referral, Source, Status, StatusEvent };

export interface ListResponse {
  opportunities: Opportunity[];
  failures: { slug: string; error: string }[];
  config: LoomConfig;
}

export interface MasterResume {
  name: string;
  path: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export const listOpportunities = () => request<ListResponse>("/api/opportunities");

export const listMasterResumes = () =>
  request<{ resumes: MasterResume[] }>("/api/master-resumes");

export interface StatusChange {
  status: Status;
  note?: string;
  label?: string;
  outcome?: Outcome;
  /** ISO instant. Omitted means now. */
  at?: string;
  state?: EventState;
  eta?: string;
}

/**
 * `null` clears a field; omitted leaves it as it is.
 *
 * `expect_at` and `expect_status` say what the caller thought sat at that index.
 * History is addressed by position and a concurrent write re-sorts it, so
 * without them a stale index would edit whatever entry is there now.
 */
export interface EventPatch {
  status?: Status;
  at?: string;
  state?: EventState;
  label?: string | null;
  note?: string | null;
  eta?: string | null;
  outcome?: Outcome | null;
  expect_at?: string;
  expect_status?: Status;
}

export interface EventExpectation {
  expect_at?: string;
  expect_status?: Status;
}

export const changeStatus = (slug: string, change: StatusChange) =>
  request<Opportunity>(`/api/opportunities/${encodeURIComponent(slug)}/status`, {
    method: "POST",
    body: JSON.stringify(change),
  });

export const updateEvent = (slug: string, index: number, patch: EventPatch) =>
  request<Opportunity>(
    `/api/opportunities/${encodeURIComponent(slug)}/history/${index}`,
    { method: "PATCH", body: JSON.stringify(patch) }
  );

export const removeEvent = (slug: string, index: number, expect: EventExpectation = {}) =>
  request<Opportunity>(
    `/api/opportunities/${encodeURIComponent(slug)}/history/${index}`,
    { method: "DELETE", body: JSON.stringify(expect) }
  );

/** `null` clears a field; omitted leaves it alone. */
export interface MetaPatch {
  company?: string;
  role?: string;
  source?: Source | null;
  referral?: Referral | null;
  url?: string | null;
  job_id?: string | null;
  posted_date?: string | null;
}

export const updateMeta = (slug: string, patch: MetaPatch) =>
  request<Opportunity>(`/api/opportunities/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export interface CreateInput {
  jd: string;
  masterResumePath: string;
  company?: string;
  role?: string;
  jobId?: string;
  postedDate?: string;
}

export const createOpportunity = (input: CreateInput) =>
  request<Opportunity>("/api/opportunities", {
    method: "POST",
    body: JSON.stringify(input),
  });
