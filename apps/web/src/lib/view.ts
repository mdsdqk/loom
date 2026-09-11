import {
  currentEvent,
  type Opportunity,
  type OpportunityMeta,
  type Status,
  type StatusEvent,
} from "@loom/tools/opportunity/pure";

/**
 * Presentation helpers. Anything that decides what a status *means* lives in
 * `@loom/tools`; this file only decides where to draw it.
 */

export const WINDOW_DAYS = 84;

export type Tone = "neutral" | "attention" | "good";

export function toneOf(opportunity: Opportunity, stalled: boolean): Tone {
  const event = currentEvent(opportunity.meta);
  if (!event) return "neutral";
  if (event.status === "closed") {
    if (event.outcome === "accepted") return "good";
    if (event.outcome === "rejected") return "attention";
    return "neutral";
  }
  if (event.status === "offer") return "good";
  return stalled ? "attention" : "neutral";
}

export const toneText: Record<Tone, string> = {
  neutral: "text-ink-2",
  attention: "text-oxide",
  good: "text-good",
};

/**
 * The stage chain, compressed: consecutive passes through one status collapse
 * into a count. A time-scaled sparkline was illegible at real data density —
 * every event inside a few days of an 84-day window — so the register reads the
 * journey as words instead.
 */
export interface Leg {
  status: Status;
  count: number;
  ahead: boolean;
}

export function journey(meta: OpportunityMeta): Leg[] {
  const legs: Leg[] = [];
  for (const event of meta.history) {
    const ahead = event.state !== "recorded";
    const last = legs[legs.length - 1];
    if (last && last.status === event.status && last.ahead === ahead) last.count += 1;
    else legs.push({ status: event.status, count: 1, ahead });
  }
  return legs;
}

/** "5d", "3w", "today" — compact enough for a dense row. */
export function since(iso: string, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d";
  if (days < 21) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}mo`;
}

/** ISO instant -> the value a <input type="datetime-local"> expects, in local time. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The datetime-local value back to an ISO instant; blank means now. */
export function fromLocalInput(value: string): string {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short" });

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** "closed · rejected", "interviewing", … */
export function statusText(event: StatusEvent | undefined): string {
  if (!event) return "unknown";
  return event.status === "closed" && event.outcome
    ? `${event.status} · ${event.outcome}`
    : event.status;
}
