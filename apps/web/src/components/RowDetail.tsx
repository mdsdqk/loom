import { useState } from "react";
import {
  OUTCOMES,
  STATUSES,
  isLoopable,
  isAhead,
  isPending,
  roundsAt,
  type Opportunity,
  type Outcome,
  type EventState,
  type Status,
  type StatusEvent,
} from "@loom/tools/opportunity/pure";
import { fmtDateTime, statusText, toLocalInput, fromLocalInput } from "../lib/view";
import type { EventPatch, StatusChange } from "../api";

/**
 * The expanded row: the recorded history on the left, the writes on the right.
 *
 * Inline rather than a dialog because none of this needs interruption or
 * protected focus — and because this is where the resume editor and its live
 * preview will attach.
 */

const FIELD =
  "w-full bg-ground border border-rule px-2 py-1.5 text-[13px] text-ink " +
  "focus:border-ink-3 focus:outline-none placeholder:text-mark";

const BTN =
  "caps cursor-pointer border border-rule-strong px-3 py-2 text-ink transition-colors " +
  "hover:border-ink-3 hover:bg-ground-3 disabled:cursor-not-allowed disabled:text-ink-4";

const MINI =
  "caps cursor-pointer border border-rule px-2 py-1 text-ink-3 transition-colors " +
  "hover:border-ink-3 hover:text-ink";

export function RowDetail({
  opportunity,
  onRecord,
  onPatch,
  onRemove,
  busy,
  error,
}: {
  opportunity: Opportunity;
  onRecord: (change: StatusChange) => void;
  onPatch: (index: number, patch: EventPatch) => void;
  onRemove: (index: number) => void;
  busy: boolean;
  error?: string;
}) {
  const history = opportunity.meta.history;
  const [editing, setEditing] = useState<number | null>(null);

  return (
    <div className="grid gap-8 border-b border-rule bg-ground-2 px-5 py-5 lg:grid-cols-[1.25fr_1fr]">
      <section>
        <h3 className="caps mb-3 border-b border-rule pb-2 text-ink-3">
          History · {history.length} {history.length === 1 ? "entry" : "entries"}
        </h3>
        <ol className="flex flex-col">
          {history.map((event, i) =>
            editing === i ? (
              <li key={`${event.at}-${i}`} className="border-b border-rule py-3 last:border-b-0">
                <EditEntry
                  event={event}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSave={(patch) => {
                    onPatch(i, patch);
                    setEditing(null);
                  }}
                  onRemove={() => {
                    onRemove(i);
                    setEditing(null);
                  }}
                />
              </li>
            ) : (
              <li
                key={`${event.at}-${i}`}
                className="group grid grid-cols-[96px_1fr_auto] items-start gap-3 border-b border-rule py-2 last:border-b-0"
              >
                <span className="caps tnum pt-[2px] text-ink-4">
                  {isAhead(event) ? (isPending(event) ? "pending" : "scheduled") : fmtDateTime(event.at)}
                </span>

                <span>
                  <span className={`caps ${isAhead(event) ? "text-ink-3" : "text-ink-2"}`}>
                    {statusText(event)}
                    {event.round && isLoopable(event.status) ? (
                      <span className="text-oxide"> · round {event.round}</span>
                    ) : null}
                    {isAhead(event) && (
                      <span
                        className={`ml-2 border px-1.5 py-px ${
                          isPending(event) ? "border-oxide/50 text-oxide" : "border-rule text-ink-4"
                        }`}
                      >
                        {isPending(event) ? "pending" : "scheduled"}
                      </span>
                    )}
                  </span>
                  {event.label && <span className="block text-[13px] text-ink">{event.label}</span>}
                  {isAhead(event) && event.eta && (
                    <span
                      className={`block text-[12.5px] ${isPending(event) ? "text-oxide" : "text-ink-3"}`}
                    >
                      {isPending(event) ? "due " : "expected "}
                      {event.eta}
                    </span>
                  )}
                  {event.note && <span className="block text-[12.5px] text-ink-3">{event.note}</span>}
                  {event.revised_at && (
                    <span className="block text-[11px] text-mark">
                      edited {fmtDateTime(event.revised_at)}
                    </span>
                  )}
                </span>

                <span className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  {isAhead(event) && (
                    <button
                      type="button"
                      className={MINI}
                      disabled={busy}
                      onClick={() =>
                        onPatch(i, { state: "recorded", at: new Date().toISOString() })
                      }
                    >
                      Mark done
                    </button>
                  )}
                  <button type="button" className={MINI} onClick={() => setEditing(i)}>
                    Edit
                  </button>
                </span>
              </li>
            )
          )}
        </ol>

        {opportunity.issues.length > 0 && (
          <p className="mt-3 text-[12px] text-oxide">{opportunity.issues.join("; ")}</p>
        )}
      </section>

      <RecordForm history={history} busy={busy} error={error} onRecord={onRecord} />
    </div>
  );
}

/**
 * Which state the entry is in. A scheduled entry needs nothing until it
 * arrives. A pending entry is work the candidate owes against a deadline.
 */
function StatePicker({
  value,
  onChange,
}: {
  value: EventState;
  onChange: (next: EventState) => void;
}) {
  const options: { value: EventState; label: string; hint: string }[] = [
    { value: "recorded", label: "Recorded", hint: "it happened" },
    { value: "scheduled", label: "Scheduled", hint: "waiting on them" },
    { value: "pending", label: "Pending", hint: "waiting on you" },
  ];

  return (
    <div>
      <span className="caps mb-1.5 block text-ink-4">State</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = value === option.value;
          const urgent = option.value === "pending";
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(option.value)}
              title={option.hint}
              className={`caps cursor-pointer border px-2.5 py-1.5 transition-colors ${
                on
                  ? urgent
                    ? "border-oxide bg-ground-3 text-oxide"
                    : "border-ink-3 bg-ground-3 text-ink"
                  : "border-rule text-ink-3 hover:border-rule-strong hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EditEntry({
  event,
  busy,
  onSave,
  onCancel,
  onRemove,
}: {
  event: StatusEvent;
  busy: boolean;
  onSave: (patch: EventPatch) => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const [status, setStatus] = useState<Status>(event.status);
  const [at, setAt] = useState(toLocalInput(event.at));
  const [label, setLabel] = useState(event.label ?? "");
  const [note, setNote] = useState(event.note ?? "");
  const [eta, setEta] = useState(event.eta ?? "");
  const [state, setState] = useState<EventState>(event.state);
  const ahead = state !== "recorded";

  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="block">
          <span className="caps mb-1 block text-ink-4">Status</span>
          <select
            className={FIELD}
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="caps mb-1 block text-ink-4">Date</span>
          <input
            type="datetime-local"
            className={FIELD}
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </label>
      </div>

      <label className="block">
        <span className="caps mb-1 block text-ink-4">Label</span>
        <input className={FIELD} value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>

      <StatePicker value={state} onChange={setState} />

      {ahead && (
        <label className="block">
          <span className="caps mb-1 block text-ink-4">
            {state === "pending" ? "Deadline" : "Expected"}
          </span>
          <input
            className={FIELD}
            value={eta}
            onChange={(e) => setEta(e.target.value)}
            placeholder="within 72 hrs · Thu 14:00 IST · TBD"
          />
        </label>
      )}

      <label className="block">
        <span className="caps mb-1 block text-ink-4">Note</span>
        <input className={FIELD} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BTN}
          disabled={busy}
          onClick={() =>
            onSave({
              status,
              at: fromLocalInput(at),
              state,
              label: label.trim() || null,
              note: note.trim() || null,
              eta: ahead ? eta.trim() || null : null,
            })
          }
        >
          Save
        </button>
        <button type="button" className={MINI} onClick={onCancel}>
          Cancel
        </button>
        <span className="flex-1" />
        <button type="button" className={`${MINI} hover:border-oxide hover:text-oxide`} onClick={onRemove}>
          Delete entry
        </button>
      </div>
    </div>
  );
}

function RecordForm({
  history,
  busy,
  error,
  onRecord,
}: {
  history: StatusEvent[];
  busy: boolean;
  error?: string;
  onRecord: (change: StatusChange) => void;
}) {
  const current = history.filter((e) => e.state === "recorded").at(-1);
  const [status, setStatus] = useState<Status>(current?.status ?? "scouted");
  const [state, setState] = useState<EventState>("recorded");
  const ahead = state !== "recorded";
  const [at, setAt] = useState(toLocalInput(new Date().toISOString()));
  const [eta, setEta] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("rejected");

  const loop = isLoopable(status);
  const nextRound = loop ? roundsAt(history, status) + 1 : undefined;

  return (
    <section>
      <h3 className="caps mb-3 border-b border-rule pb-2 text-ink-3">
        {ahead ? "New entry" : "Record a change"}
      </h3>

      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="caps mb-1.5 block text-ink-4">Status</span>
          <select
            className={FIELD}
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <StatePicker value={state} onChange={setState} />

        {ahead ? (
          <label className="block">
            <span className="caps mb-1.5 block text-ink-4">
              {state === "pending" ? "Deadline" : "Expected"}
            </span>
            <input
              className={FIELD}
              value={eta}
              onChange={(e) => setEta(e.target.value)}
              placeholder="within 72 hrs · Thu 14:00 IST · TBD, week after"
            />
            <span className="mt-1.5 block text-[12px] text-ink-4">
              Free text. Scheduled and pending entries don&apos;t change the status or the idle
              clock.
            </span>
          </label>
        ) : (
          <label className="block">
            <span className="caps mb-1.5 block text-ink-4">Date</span>
            <input
              type="datetime-local"
              className={FIELD}
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </label>
        )}

        {loop && (
          <label className="block">
            <span className="caps mb-1.5 block text-ink-4">Round {nextRound} label</span>
            <input
              className={FIELD}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="coding round, system design, hiring manager…"
            />
          </label>
        )}

        {status === "closed" && !ahead && (
          <label className="block">
            <span className="caps mb-1.5 block text-ink-4">Outcome</span>
            <select
              className={FIELD}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as Outcome)}
            >
              {OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="caps mb-1.5 block text-ink-4">Note</span>
          <input
            className={FIELD}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="optional"
          />
        </label>

        {error && <p className="text-[12.5px] text-oxide">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            className={BTN}
            onClick={() => {
              onRecord({
                status,
                state,
                at: ahead ? undefined : fromLocalInput(at),
                eta: ahead ? eta.trim() || undefined : undefined,
                label: loop && label.trim() ? label.trim() : undefined,
                note: note.trim() || undefined,
                outcome: status === "closed" && !ahead ? outcome : undefined,
              });
              setLabel("");
              setNote("");
              setEta("");
              setAt(toLocalInput(new Date().toISOString()));
            }}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <span className="text-[12px] text-ink-4">
            {ahead ? "Mark it done when it happens." : "Appends to history."}
          </span>
        </div>
      </div>
    </section>
  );
}
