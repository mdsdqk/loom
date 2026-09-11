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
  roundsAt,
} from "./schema.js";

/**
 * Pure derivations over a parsed `meta.yml`.
 *
 * No filesystem, no I/O: the web client imports these to render exactly what
 * the CLI computes, so "stalled" means one thing everywhere.
 *
 * Every "where does this stand" answer reads recorded entries only. A booked
 * interview is a commitment, not a fact, so it must not advance the status or
 * reset the idle clock — an opportunity waiting three weeks for a scheduled
 * round is still waiting.
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

export function currentEvent(meta: OpportunityMeta): StatusEvent | undefined {
  const recorded = recordedEvents(meta);
  return recorded[recorded.length - 1];
}

export function currentStatus(meta: OpportunityMeta): Status | undefined {
  return currentEvent(meta)?.status ?? meta.status;
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
  return event.round ?? roundsAt(recordedEvents(meta), event.status);
}

/**
 * Every pass through a loopable status, in order — what turns "interviewing"
 * into "round 1, round 2, round 3" with the date and what each round was.
 * Includes a scheduled round so an upcoming one is visible alongside the rest.
 */
export function rounds(meta: OpportunityMeta, status: Status): StatusEvent[] {
  return meta.history.filter((event) => event.status === status);
}

export function idleDays(meta: OpportunityMeta, now: Date = new Date()): number {
  const event = currentEvent(meta);
  if (!event) return 0;
  return Math.floor((now.getTime() - new Date(event.at).getTime()) / 86_400_000);
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
