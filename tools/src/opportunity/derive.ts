import { type LoomConfig, DEFAULT_CONFIG, stallThresholdFor } from "./config.js";
import {
  type OpportunityMeta,
  type Status,
  type StatusEvent,
  isAhead,
  isLoopable,
  isPending,
  isRecorded,
  isScheduled,
  statusIndex,
} from "./schema.js";

/**
 * Pure derivations over a parsed `meta.yml`.
 *
 * No filesystem, no I/O: the web client imports these to render exactly what
 * the CLI computes, so "stalled" means one thing everywhere.
 */

export function recordedEvents(meta: OpportunityMeta): StatusEvent[] {
  return meta.history.filter(isRecorded);
}

/** Booked slots where nothing is required from the candidate. */
export function scheduledEvents(meta: OpportunityMeta): StatusEvent[] {
  return meta.history.filter(isScheduled);
}

/** Work the candidate owes, against a deadline. */
export function pendingEvents(meta: OpportunityMeta): StatusEvent[] {
  return meta.history.filter(isPending);
}

/** Everything still ahead, pending first. */
export function openEvents(meta: OpportunityMeta): StatusEvent[] {
  return meta.history.filter(isAhead);
}

/** The last thing that actually happened. */
export function lastRecorded(meta: OpportunityMeta): StatusEvent | undefined {
  const recorded = recordedEvents(meta);
  return recorded[recorded.length - 1];
}

/**
 * The entry that says where the opportunity stands.
 *
 * This is the furthest stage anything has reached, booked entries included.
 * Scheduling an interview is the company moving the candidate to the interview
 * stage; it is news, not a plan the candidate made up. Waiting for the round to
 * happen before saying so left an opportunity reading `screening` when an
 * assessment was already set.
 *
 * Taking the furthest stage rather than the last entry keeps the stage from
 * going backwards when a later entry belongs to an earlier one, such as a
 * follow-up screening call booked mid-loop. `closed` is last in the pipeline,
 * so a closed opportunity stays closed whatever is still on the calendar.
 */
export function currentEvent(meta: OpportunityMeta): StatusEvent | undefined {
  let best: StatusEvent | undefined;
  for (const event of meta.history) {
    if (!best || statusIndex(event.status) >= statusIndex(best.status)) best = event;
  }
  return best;
}

export function currentStatus(meta: OpportunityMeta): Status | undefined {
  return currentEvent(meta)?.status;
}

/** Whether the stage the opportunity is at has actually happened yet. */
export function currentIsAhead(meta: OpportunityMeta): boolean {
  const event = currentEvent(meta);
  return event ? isAhead(event) : false;
}

/** The next booked slot, when one exists. */
export function nextScheduled(meta: OpportunityMeta): StatusEvent | undefined {
  return scheduledEvents(meta)[0];
}

/**
 * The one thing to look at next: work the candidate owes, or failing that the
 * next booked slot. This is what the register shows beside the status.
 */
export function nextAction(meta: OpportunityMeta): StatusEvent | undefined {
  return pendingEvents(meta)[0] ?? scheduledEvents(meta)[0];
}

/** Is the candidate the one holding this up? */
export function awaitingCandidate(meta: OpportunityMeta): boolean {
  return pendingEvents(meta).length > 0;
}

/** Which pass through the current status this is, for a status that loops. */
export function currentRound(meta: OpportunityMeta): number | undefined {
  const event = currentEvent(meta);
  if (!event || !isLoopable(event.status)) return undefined;
  return event.round;
}

/**
 * Every pass through a loopable status, in order — what turns "interviewing"
 * into "round 1, round 2, round 3" with the date and what each round was.
 * Includes a scheduled round so an upcoming one is visible alongside the rest.
 */
export function rounds(meta: OpportunityMeta, status: Status): StatusEvent[] {
  return meta.history.filter((event) => event.status === status);
}

/**
 * Days since anything last moved.
 *
 * Booking a round is movement, so it counts. An opportunity whose newest entry
 * is a booking made three weeks ago has still gone quiet, and the threshold
 * catches that without a special case.
 */
export function idleDays(meta: OpportunityMeta, now: Date = new Date()): number {
  let latest: number | undefined;
  for (const event of meta.history) {
    const at = new Date(event.at).getTime();
    if (latest === undefined || at > latest) latest = at;
  }
  if (latest === undefined) return 0;
  return Math.floor((now.getTime() - latest) / 86_400_000);
}

export function isStalled(
  meta: OpportunityMeta,
  config: LoomConfig = DEFAULT_CONFIG,
  now: Date = new Date()
): boolean {
  const status = currentStatus(meta);
  if (!status) return false;
  const threshold = stallThresholdFor(status, config);
  if (threshold === null) return false;
  return idleDays(meta, now) >= threshold;
}
