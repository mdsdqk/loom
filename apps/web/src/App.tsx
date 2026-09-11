import { useCallback, useEffect, useMemo, useState } from "react";
import {
  STATUSES,
  currentRound,
  currentStatus,
  idleDays,
  isStalled,
  nextAction,
  awaitingCandidate,
  type LoomConfig,
  type Status,
} from "@loom/tools/opportunity/pure";
import * as api from "./api";
import type { EventPatch, MasterResume, StatusChange } from "./api";
import { Artifacts, Stages, StatusCell } from "./components/Marks";
import { RowDetail } from "./components/RowDetail";
import { NewOpportunity } from "./components/NewOpportunity";
import { since, toneOf } from "./lib/view";

type Filter = "all" | "live" | "stalled" | "owed" | Status;

export default function App() {
  const [data, setData] = useState<api.ListResponse | null>(null);
  const [resumes, setResumes] = useState<MasterResume[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setData(await api.listOpportunities());
      setLoadError(undefined);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
    void api.listMasterResumes().then((r) => setResumes(r.resumes)).catch(() => setResumes([]));
  }, [refresh]);

  const config: LoomConfig | undefined = data?.config;

  const rows = useMemo(() => {
    if (!data) return [];
    const withDerived = data.opportunities.map((opportunity) => {
      const stalled = config ? isStalled(opportunity.meta, config) : false;
      return {
        opportunity,
        status: currentStatus(opportunity.meta),
        stalled,
        idle: idleDays(opportunity.meta),
        lastAt: opportunity.meta.history.filter((e) => e.state === "recorded").at(-1)?.at,
        round: currentRound(opportunity.meta),
        action: nextAction(opportunity.meta),
        owed: awaitingCandidate(opportunity.meta),
        tone: toneOf(opportunity, stalled),
      };
    });

    const filtered = withDerived.filter((row) => {
      if (filter === "all") return true;
      if (filter === "live") return row.status !== "closed";
      if (filter === "stalled") return row.stalled;
      if (filter === "owed") return row.owed;
      return row.status === filter;
    });

    /* Pending first, then closed last, then longest idle. */
    return filtered.sort((a, b) => {
      if (a.owed !== b.owed) return a.owed ? -1 : 1;
      const ac = a.status === "closed";
      const bc = b.status === "closed";
      if (ac !== bc) return ac ? 1 : -1;
      return b.idle - a.idle;
    });
  }, [data, config, filter]);

  const counts = useMemo(() => {
    const map = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
    let live = 0;
    let stalled = 0;
    let owed = 0;
    for (const opportunity of data?.opportunities ?? []) {
      const status = currentStatus(opportunity.meta);
      if (status) map[status] += 1;
      if (status !== "closed") live += 1;
      if (config && isStalled(opportunity.meta, config)) stalled += 1;
      if (awaitingCandidate(opportunity.meta)) owed += 1;
    }
    return { map, live, stalled, owed, all: data?.opportunities.length ?? 0 };
  }, [data, config]);

  async function mutate(slug: string, run: () => Promise<unknown>) {
    setBusySlug(slug);
    setRowError((prev) => ({ ...prev, [slug]: "" }));
    try {
      await run();
      await refresh();
    } catch (error) {
      setRowError((prev) => ({
        ...prev,
        [slug]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setBusySlug(null);
    }
  }

  const record = (slug: string, change: StatusChange) =>
    mutate(slug, () => api.changeStatus(slug, change));
  const patchEvent = (slug: string, index: number, patch: EventPatch) =>
    mutate(slug, () => api.updateEvent(slug, index, patch));
  const dropEvent = (slug: string, index: number) =>
    mutate(slug, () => api.removeEvent(slug, index));

  async function create(input: Parameters<typeof api.createOpportunity>[0]) {
    setCreateBusy(true);
    setCreateError(undefined);
    try {
      const created = await api.createOpportunity(input);
      await refresh();
      setCreating(false);
      setExpanded(created.slug);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreateBusy(false);
    }
  }

  const chip = (key: Filter, label: string, n: number) => (
    <button
      key={key}
      type="button"
      aria-pressed={filter === key}
      onClick={() => setFilter(key)}
      className={`caps cursor-pointer border px-[9px] py-[4px] transition-colors ${
        filter === key
          ? "border-ink-3 bg-ground-2 text-ink"
          : "border-rule text-ink-3 hover:border-rule-strong hover:text-ink"
      }`}
    >
      {label} <span className={filter === key ? "text-ink-3" : "text-ink-4"}>{n}</span>
    </button>
  );

  /* Every column reads from the same left edge. Narrow screens drop the journey
     and the file/source columns and move status under the role. */
  const grid =
    "grid items-center gap-x-5 gap-y-0.5 px-5 pl-[14px] text-left " +
    "grid-cols-[22px_1fr_56px] " +
    "md:grid-cols-[30px_minmax(170px,1fr)_minmax(230px,1.1fr)_56px] " +
    "xl:grid-cols-[30px_minmax(180px,1fr)_minmax(250px,1.15fr)_minmax(190px,1fr)_56px_64px_88px]";
  const colStatus = "col-start-2 row-start-2 md:col-start-3 md:row-start-1";
  const colIdle = "col-start-3 row-start-1 md:col-start-4 xl:col-start-5";

  return (
    <>
      <div className="rail-ticks fixed inset-y-0 left-0 z-20 w-[34px] border-r border-rule" />

      <div className="ml-[34px] flex min-h-screen flex-col">
        <header className="sticky top-0 z-10 flex h-[52px] items-center gap-5 border-b border-rule bg-ground px-5 pl-[18px]">
          <span className="font-mono text-[12px] font-medium tracking-[0.32em] uppercase">
            Loom
          </span>
          <span className="caps border border-rule-strong bg-ground-2 px-[11px] py-[5px] text-ink">
            Register
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="caps flex cursor-pointer items-center gap-[7px] border border-rule-strong px-3 py-[6px] text-ink transition-colors hover:border-ink-3 hover:bg-ground-3"
          >
            <svg viewBox="0 0 12 12" className="h-[11px] w-[11px] fill-none stroke-current" strokeWidth={1.5}>
              <path d="M6 1v10M1 6h10" />
            </svg>
            <span className="hidden sm:inline">New opportunity</span>
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-rule px-5 py-2.5 pl-[18px]">
          {chip("all", "All", counts.all)}
          {chip("live", "Live", counts.live)}
          {chip("owed", "Pending", counts.owed)}
          {chip("stalled", "Stalled", counts.stalled)}
          {STATUSES.map((s) => chip(s, s, counts.map[s]))}
          {config && (
            <span className="caps ml-auto text-ink-4">
              stalled after {config.stall_threshold_days}d
            </span>
          )}
        </div>

        <div className={`${grid} h-[30px] border-b border-rule-strong`}>
          <span />
          <span className="caps text-ink-3">Company</span>
          <span className={`caps hidden text-ink-3 md:inline ${colStatus}`}>Status</span>
          <span className="caps hidden text-ink-3 xl:inline">Stages</span>
          <span className={`caps text-ink-3 ${colIdle}`}>Idle</span>
          <span className="caps hidden text-ink-3 xl:inline">Files</span>
          <span className="caps hidden text-ink-3 xl:inline">Source</span>
        </div>

        {loadError && (
          <p className="border-b border-rule px-5 py-4 text-[13px] text-oxide">
            {loadError}. Is the API running? <code className="font-mono">pnpm dev</code>
          </p>
        )}

        {data && rows.length === 0 && !loadError && (
          <p className="border-b border-rule px-5 py-10 text-[13px] text-ink-3">
            {counts.all === 0
              ? "No opportunities yet."
              : "Nothing matches this filter."}
          </p>
        )}

        {rows.map((row, i) => {
          const slug = row.opportunity.slug;
          const open = expanded === slug;
          const closed = row.status === "closed";
          return (
            <div key={slug}>
              <div
                className={`${grid} min-h-[54px] py-2 cursor-pointer border-b border-rule transition-colors hover:bg-ground-2 md:py-0 ${
                  open ? "bg-ground-2" : ""
                }`}
                tabIndex={0}
                role="button"
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : slug)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpanded(open ? null : slug);
                  }
                }}
              >
                <span className="font-mono tnum text-[10px] text-ink-4">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="overflow-hidden">
                  <span
                    className={`block truncate text-[14px] font-medium tracking-[-0.01em] ${
                      closed ? "text-ink-3" : "text-ink"
                    }`}
                  >
                    {row.opportunity.meta.company}
                  </span>
                  <span className="block truncate text-[12px] text-ink-3">
                    {row.opportunity.meta.role}
                  </span>
                </span>
                <span className={`min-w-0 ${colStatus}`}>
                  <StatusCell
                    meta={row.opportunity.meta}
                    tone={row.tone}
                    round={row.round}
                    action={row.action}
                  />
                </span>
                <span className="hidden min-w-0 xl:block">
                  <Stages meta={row.opportunity.meta} />
                </span>
                <span
                  className={`font-mono tnum text-[12px] ${colIdle} ${
                    row.stalled ? "text-oxide" : "text-ink-3"
                  }`}
                >
                  {row.lastAt ? since(row.lastAt) : "\u2014"}
                </span>
                <span className="hidden xl:block">
                  <Artifacts present={row.opportunity.artifacts} />
                </span>
                <span className="caps hidden text-ink-4 xl:inline">
                  {row.opportunity.meta.source ?? "manual"}
                </span>
              </div>

              {open && (
                <RowDetail
                  opportunity={row.opportunity}
                  busy={busySlug === slug}
                  error={rowError[slug] || undefined}
                  onRecord={(change) => void record(slug, change)}
                  onPatch={(index, patch) => void patchEvent(slug, index, patch)}
                  onRemove={(index) => void dropEvent(slug, index)}
                />
              )}
            </div>
          );
        })}

        {data && data.failures.length > 0 && (
          <p className="border-b border-rule px-5 py-3 text-[12.5px] text-oxide">
            {data.failures.length} unreadable{" "}
            {data.failures.length === 1 ? "file" : "files"}:{" "}
            {data.failures.map((f) => f.slug).join(", ")}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-rule px-5 py-3 pl-[18px]">
          <span className="caps flex items-center gap-2 text-oxide">
            <span className="h-[3px] w-[14px] bg-oxide" />
            Pending: waiting on you, with a deadline
          </span>
          <span className="caps flex items-center gap-2 text-ink-4">
            <span className="h-[3px] w-[14px] bg-mark" />
            Scheduled: waiting on them
          </span>
          <span className="caps text-ink-4">Idle counts from the last recorded entry</span>
        </div>
      </div>

      <NewOpportunity
        open={creating}
        resumes={resumes}
        busy={createBusy}
        error={createError}
        onClose={() => setCreating(false)}
        onCreate={(input) => void create(input)}
      />
    </>
  );
}
