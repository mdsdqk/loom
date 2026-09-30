import {
  currentEvent,
  currentIsAhead,
  isLoopable,
  type ArtifactPresence,
  type OpportunityMeta,
  type StatusEvent,
} from "@loom/tools/opportunity/pure";
import { journey, statusText, toneText, type Tone } from "../lib/view";

/**
 * Row marks.
 *
 * An earlier version drew a seven-cell pipeline track and a time-scaled pen
 * trace per row. Both were unreadable against real data — every event inside a
 * few days of an 84-day window — so the register now reads as words: the
 * status, what is outstanding, and the stage chain.
 */

/** Where the opportunity stands, plus whose move it is next. */
export function StatusCell({
  meta,
  tone,
  round,
  action,
}: {
  meta: OpportunityMeta;
  tone: Tone;
  round?: number;
  action?: StatusEvent;
}) {
  const event = currentEvent(meta);
  const ahead = currentIsAhead(meta);
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        className={`caps shrink-0 ${toneText[tone]}`}
        title={ahead ? "this stage is set but has not happened yet" : undefined}
      >
        {statusText(event)}
        {ahead && <span className="text-ink-4"> *</span>}
      </span>
      {round !== undefined && round > 1 && (
        <span className="caps tnum shrink-0 text-ink-4">R{round}</span>
      )}
      {action && <ActionBadge event={action} />}
    </span>
  );
}

/**
 * The outstanding entry. A scheduled entry is waiting on them and reads quietly.
 * A pending entry is waiting on the candidate and takes the accent.
 */
export function ActionBadge({ event }: { event: StatusEvent }) {
  const owed = event.state === "pending";
  return (
    <span
      className={`caps flex min-w-0 items-center gap-1.5 border px-1.5 py-px ${
        owed ? "border-oxide/50 text-oxide" : "border-rule text-ink-4"
      }`}
      title={`${event.status}${event.label ? " · " + event.label : ""}${
        event.eta ? " · " + event.eta : ""
      }`}
    >
      <svg
        viewBox="0 0 10 10"
        className={`h-[9px] w-[9px] shrink-0 fill-none ${owed ? "stroke-oxide" : "stroke-ink-4"}`}
        strokeWidth={1.3}
      >
        {owed ? (
          <>
            <path d="M2.4 1h5.2M2.4 9h5.2" />
            <path d="M3 1c0 2 4 2 4 0M3 9c0-2 4-2 4 0" />
          </>
        ) : (
          <>
            <circle cx="5" cy="5" r="4" />
            <path d="M5 2.6V5l1.7 1.1" />
          </>
        )}
      </svg>
      <span className="truncate">
        {owed ? "pending" : "scheduled"}
        {event.eta ? ` · ${event.eta}` : ""}
      </span>
    </span>
  );
}

/** The stage chain: scouted, applied, screening x2, interviewing. */
export function Stages({ meta }: { meta: OpportunityMeta }) {
  const legs = journey(meta);
  const shown = legs.slice(-4);
  const trimmed = legs.length > shown.length;

  return (
    <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
      {trimmed && <span className="caps shrink-0 text-mark">...</span>}
      {shown.map((leg, i) => (
        <span key={`${leg.status}-${i}`} className="flex shrink-0 items-center gap-1.5">
          {i > 0 && <span className="text-[11px] text-mark">&rarr;</span>}
          <span
            className={`caps ${
              leg.ahead
                ? "text-ink-4 opacity-70"
                : i === shown.length - 1
                  ? "text-ink-2"
                  : "text-ink-3"
            }`}
          >
            {leg.status}
            {leg.count > 1 && <span className="tnum text-mark"> &times;{leg.count}</span>}
          </span>
        </span>
      ))}
    </span>
  );
}

const ART_PATHS: Record<keyof ArtifactPresence, string> = {
  jd: "M3 1.5h5l2 2v8H3z M8 1.5v2h2 M5 6h4M5 8.5h4",
  resume: "M2 2h9v9H2z M4.2 4.6h2M4.2 6.5h4.6M4.2 8.4h3.2",
  pdf: "M3 1.5h5l2 2v8H3z M8 1.5v2h2 M4.6 9V6.4h1.1a.8.8 0 0 1 0 1.6H4.6",
};

export function Artifacts({ present }: { present: ArtifactPresence }) {
  return (
    <span className="inline-flex gap-[5px]">
      {(Object.keys(ART_PATHS) as (keyof ArtifactPresence)[]).map((key) => (
        <svg
          key={key}
          viewBox="0 0 13 13"
          className={`h-[13px] w-[13px] fill-none ${present[key] ? "stroke-ink-2" : "stroke-mark"}`}
          strokeWidth={1.25}
          role="img"
          aria-label={`${key} ${present[key] ? "present" : "missing"}`}
        >
          <path d={ART_PATHS[key]} />
        </svg>
      ))}
    </span>
  );
}

/** Rounds completed within the current looping status. */
export function RoundRun({ meta }: { meta: OpportunityMeta }) {
  const event = meta.history.filter((e) => e.state === "recorded").at(-1);
  if (!event || !isLoopable(event.status) || !event.round || event.round < 2) return null;
  return <span className="caps tnum text-ink-4">{event.round} rounds</span>;
}
