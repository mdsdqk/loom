import { z } from "zod";

/**
 * Runtime schema for `opportunities/<slug>/meta.yml`.
 *
 * Status is stored as an append-only `history`, with `status` kept alongside it
 * as a derived cache so a CLI can read one key without walking the list. The
 * store recomputes the cache on every write; `validateMeta` reports a
 * disagreement rather than trusting either side.
 */

export const STATUSES = [
  "scouted",
  "drafting",
  "applied",
  "screening",
  "interviewing",
  "offer",
  "closed",
] as const;

export const StatusSchema = z.enum(STATUSES);
export type Status = (typeof STATUSES)[number];

export const OUTCOMES = ["accepted", "rejected", "withdrawn", "expired"] as const;
export const OutcomeSchema = z.enum(OUTCOMES);
export type Outcome = (typeof OUTCOMES)[number];

export const SOURCES = ["network-scan", "manual", "referral"] as const;
export const SourceSchema = z.enum(SOURCES);
export type Source = (typeof SOURCES)[number];

/**
 * Statuses that are a loop rather than a point.
 *
 * An interview is not one event: the number of rounds varies per company and is
 * not known in advance, so each round is its own history entry at the same
 * status, numbered by `round`. `screening` behaves the same way — a recruiter
 * call and a take-home are two passes through one stage.
 */
export const LOOPABLE_STATUSES: readonly Status[] = ["screening", "interviewing"];

export function isLoopable(status: Status): boolean {
  return LOOPABLE_STATUSES.includes(status);
}

/** Statuses that are terminal: nothing follows them except a correction. */
export const TERMINAL_STATUSES: readonly Status[] = ["closed"];

export function statusIndex(status: Status): number {
  return STATUSES.indexOf(status);
}

/**
 * YAML timestamps parse to `Date` under the default schema, but a hand-edited
 * file may carry a plain string. Both normalize to an ISO string here so the
 * rest of the system only ever sees one shape.
 */
const IsoTimestamp = z.preprocess((value) => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return value;
}, z.string().min(1));

/**
 * A bare `2026-08-14` in YAML parses to a `Date`, not a string — which is what
 * `create-opportunity` writes for `posted_date`. Normalize both spellings to
 * `YYYY-MM-DD` so a posting date never fails to load.
 */
const YamlDate = z.preprocess((value) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}, z.string().min(1));

/**
 * Whether an entry already happened, or is still ahead — and if ahead, whose
 * move it is.
 *
 * `scheduled` is a commitment where nothing is required from the candidate: an
 * interview slot sits in the diary until it happens. `pending` is work the
 * candidate owes against a deadline: an online assessment, a take-home. Both are
 * ahead of the pen, so neither advances the status or counts toward idle time —
 * but only one of them is something to act on today.
 */
export const EVENT_STATES = ["recorded", "scheduled", "pending"] as const;
export const EventStateSchema = z.enum(EVENT_STATES);
export type EventState = (typeof EVENT_STATES)[number];

export const StatusEventSchema = z
  .object({
    /**
     * For a recorded entry, when it happened. For a scheduled one, when it was
     * put on the calendar — `eta` carries when it is expected, because a real
     * expectation is often a range or a condition rather than a timestamp.
     */
    at: IsoTimestamp,
    status: StatusSchema,
    state: EventStateSchema.default("recorded"),
    /**
     * Freeform time expression, unvalidated on purpose — the real ones do not
     * fit a date picker. On a `scheduled` entry it is when it is expected
     * ("Thu 14:00 IST"); on a `pending` one it is the deadline
     * ("within 72 hrs").
     */
    eta: z.string().min(1).optional(),
    /** 1-based pass through a loopable status. Assigned by the store when omitted. */
    round: z.number().int().positive().optional(),
    /** What this round actually was, e.g. "system design", "hiring manager". */
    label: z.string().min(1).optional(),
    note: z.string().min(1).optional(),
    outcome: OutcomeSchema.optional(),
    /** Set when an entry is edited after the fact, so a correction stays visible. */
    revised_at: IsoTimestamp.optional(),
  })
  .refine((event) => event.outcome === undefined || event.status === "closed", {
    message: "outcome is only meaningful on a closed event",
    path: ["outcome"],
  })
  .refine((event) => event.state !== "recorded" || event.eta === undefined, {
    message: "eta is only meaningful on a scheduled or pending event",
    path: ["eta"],
  });

export type StatusEvent = z.infer<typeof StatusEventSchema>;

/**
 * Unknown top-level keys are preserved, not stripped: another tool may have
 * written a field this version does not know about, and a portal write must
 * not silently drop it.
 */
export const OpportunityMetaSchema = z.looseObject({
  company: z.string().min(1),
  role: z.string().min(1),
  job_id: z.string().min(1).optional(),
  posted_date: YamlDate.optional(),
  source: SourceSchema.optional(),
  url: z.string().min(1).optional(),
  status: StatusSchema.optional(),
  history: z.array(StatusEventSchema).default([]),
});

export type OpportunityMeta = z.infer<typeof OpportunityMetaSchema>;

export interface MetaValidationIssue {
  path: string;
  message: string;
}

export interface MetaValidationResult {
  ok: boolean;
  issues: MetaValidationIssue[];
  meta?: OpportunityMeta;
}

/**
 * Validates already-parsed YAML against the meta shape, returning readable
 * path+message issues instead of throwing. A `status` cache that disagrees with
 * the last history entry is reported as an issue — it is a repair case, not a
 * crash, so callers can decide whether to fix or surface it.
 */
export function validateMeta(data: unknown): MetaValidationResult {
  const result = OpportunityMetaSchema.safeParse(data);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
        message: issue.message,
      })),
    };
  }

  const meta = result.data;
  const issues: MetaValidationIssue[] = [];

  /*
   * The cache follows the last *recorded* entry. A scheduled entry sits at the
   * end of the list but has not happened, so comparing against the raw last
   * element reports a mismatch on every opportunity with something booked.
   */
  const recorded = meta.history.filter(isRecorded);
  const last = recorded[recorded.length - 1];

  if (last && meta.status && meta.status !== last.status) {
    issues.push({
      path: "status",
      message: `cached status "${meta.status}" disagrees with the last recorded entry "${last.status}"`,
    });
  }

  if (!isChronological(meta.history)) {
    issues.push({ path: "history", message: "history entries are not in chronological order" });
  }

  return { ok: issues.length === 0, issues, meta };
}

export function isRecorded(event: StatusEvent): boolean {
  return event.state === "recorded";
}

export function isScheduled(event: StatusEvent): boolean {
  return event.state === "scheduled";
}

/** Work the candidate owes, against a deadline. */
export function isPending(event: StatusEvent): boolean {
  return event.state === "pending";
}

/** Anything ahead of the pen, whoever owes it. */
export function isAhead(event: StatusEvent): boolean {
  return event.state !== "recorded";
}

/**
 * Chronology is only claimed of what actually happened. Scheduled entries sit
 * after the recorded ones regardless of when they were put on the calendar.
 */
export function isChronological(history: readonly StatusEvent[]): boolean {
  const recorded = history.filter(isRecorded);
  for (let i = 1; i < recorded.length; i += 1) {
    if (new Date(recorded[i].at).getTime() < new Date(recorded[i - 1].at).getTime()) return false;
  }
  return true;
}

/**
 * Recorded entries in time order, then what is still ahead — pending first,
 * because work the candidate owes outranks a slot in someone else's diary.
 */
export function sortHistory(history: readonly StatusEvent[]): StatusEvent[] {
  const byTime = (a: StatusEvent, b: StatusEvent) =>
    new Date(a.at).getTime() - new Date(b.at).getTime();
  return [
    ...history.filter(isRecorded).sort(byTime),
    ...history.filter(isPending).sort(byTime),
    ...history.filter(isScheduled).sort(byTime),
  ];
}

/**
 * Renumbers each looping status 1..n in the order the entries now sit.
 *
 * A round is an ordinal position in time, not the order things were typed in.
 * Backdating an entry or correcting a date can therefore change what round
 * something was, and leaving the old numbers would show round 2 before round 1.
 */
export function renumberRounds(history: readonly StatusEvent[]): StatusEvent[] {
  const seen = new Map<Status, number>();
  return history.map((event) => {
    if (!isLoopable(event.status)) {
      if (event.round === undefined) return event;
      const without = { ...event };
      delete without.round;
      return without;
    }
    const round = (seen.get(event.status) ?? 0) + 1;
    seen.set(event.status, round);
    return event.round === round ? event : { ...event, round };
  });
}

/** Sort into the order things happened, then make the round numbers agree. */
export function normalizeHistory(history: readonly StatusEvent[]): StatusEvent[] {
  return renumberRounds(sortHistory(history));
}

/**
 * How many times this opportunity has entered `status`, counting a scheduled
 * round: booking interview round 3 makes it round 3, not a second round 2.
 */
export function roundsAt(history: readonly StatusEvent[], status: Status): number {
  return history.reduce((count, event) => (event.status === status ? count + 1 : count), 0);
}

/**
 * The round number a new event at `status` should carry: the next pass through
 * a loopable status, or undefined for a status that is a single point.
 */
export function nextRound(
  history: readonly StatusEvent[],
  status: Status
): number | undefined {
  if (!isLoopable(status)) return undefined;
  return roundsAt(history, status) + 1;
}

/** Which of an opportunity's artifact files are actually on disk. */
export interface ArtifactPresence {
  jd: boolean;
  resume: boolean;
  pdf: boolean;
}

/** One opportunity as every consumer sees it: its slug, its meta, what exists on disk. */
export interface Opportunity {
  slug: string;
  meta: OpportunityMeta;
  artifacts: ArtifactPresence;
  /** Issues found while reading, e.g. a status cache that disagrees with history. */
  issues: string[];
}
