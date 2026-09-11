import type { Dirent } from "node:fs";
import { readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { stringify } from "yaml";
import {
  type ArtifactPresence,
  type EventState,
  type Opportunity,
  type OpportunityMeta,
  type Status,
  type StatusEvent,
  nextRound,
  normalizeHistory,
  validateMeta,
} from "./schema.js";
import { currentStatus } from "./derive.js";

export type { ArtifactPresence, Opportunity } from "./schema.js";

/**
 * Filesystem store for opportunities.
 *
 * This is a library, not an endpoint. The web portal, the existing CLIs and a
 * future MCP server all call these functions, so no HTTP or UI concept appears
 * here. Roots are resolved per call rather than read from a module constant,
 * because one installation serves one candidate but the code serves any.
 */

export const OPPORTUNITIES_DIR_ENV = "LOOM_OPPORTUNITIES_DIR";
export const DEFAULT_OPPORTUNITIES_DIR = "../opportunities";

export function resolveOpportunitiesRoot(explicit?: string): string {
  return resolve(explicit ?? process.env[OPPORTUNITIES_DIR_ENV] ?? DEFAULT_OPPORTUNITIES_DIR);
}

export interface OpportunityPaths {
  dir: string;
  meta: string;
  artifactsDir: string;
  jd: string;
  resume: string;
}

export function opportunityPaths(slug: string, root?: string): OpportunityPaths {
  const dir = resolve(resolveOpportunitiesRoot(root), slug);
  const artifactsDir = resolve(dir, "artifacts");
  return {
    dir,
    meta: resolve(dir, "meta.yml"),
    artifactsDir,
    jd: resolve(artifactsDir, "jd.md"),
    resume: resolve(artifactsDir, "resume.yml"),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function listArtifacts(dir: string): Promise<ArtifactPresence> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { jd: false, resume: false, pdf: false };
  }
  return {
    jd: entries.includes("jd.md"),
    resume: entries.includes("resume.yml"),
    pdf: entries.some((name) => name.toLowerCase().endsWith(".pdf")),
  };
}

/**
 * A `meta.yml` predating status tracking is valid and must stay readable. It
 * reads as a single `scouted` event dated from the directory's own mtime — the
 * closest honest answer available — and the first real status change
 * materializes the list. Nothing is written to disk until then.
 */
async function synthesizeHistory(dir: string): Promise<StatusEvent[]> {
  let at = new Date();
  try {
    at = (await stat(dir)).mtime;
  } catch {
    /* fall through to now */
  }
  return [{ at: at.toISOString(), status: "scouted", state: "recorded" }];
}

export async function readOpportunity(slug: string, root?: string): Promise<Opportunity> {
  const paths = opportunityPaths(slug, root);
  const raw = await readFile(paths.meta, "utf8");
  const parsed = load(raw) ?? {};

  /* An absent `history` key is a file that predates status tracking; an explicit
     empty list is a deliberate "nothing has happened yet". Only the first gets a
     synthesized event. */
  const hasHistoryKey =
    typeof parsed === "object" && parsed !== null && "history" in (parsed as object);

  const result = validateMeta(parsed);
  if (!result.meta) {
    const detail = result.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new Error(`Invalid meta.yml for "${slug}" — ${detail}`);
  }

  const meta = result.meta;
  if (meta.history.length === 0 && !hasHistoryKey) {
    meta.history = await synthesizeHistory(paths.dir);
    meta.status = meta.history[0].status;
  }

  return {
    slug,
    meta,
    artifacts: await listArtifacts(paths.artifactsDir),
    issues: result.issues.map((i) => `${i.path}: ${i.message}`),
  };
}

/**
 * Every directory under the root that carries a `meta.yml`. A directory that
 * fails to parse is reported in `failures` rather than aborting the listing —
 * one bad file must not hide the other thirteen opportunities.
 */
export async function listOpportunities(
  root?: string
): Promise<{ opportunities: Opportunity[]; failures: { slug: string; error: string }[] }> {
  const dir = resolveOpportunitiesRoot(root);
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { opportunities: [], failures: [] };
    throw error;
  }

  const opportunities: Opportunity[] = [];
  const failures: { slug: string; error: string }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    if (!(await exists(opportunityPaths(slug, root).meta))) continue;
    try {
      opportunities.push(await readOpportunity(slug, root));
    } catch (error) {
      failures.push({ slug, error: error instanceof Error ? error.message : String(error) });
    }
  }

  opportunities.sort((a, b) => a.slug.localeCompare(b.slug));
  return { opportunities, failures };
}

/**
 * Writes `meta.yml` through a temp file in the same directory, then renames.
 * These files are gitignored, so a half-written meta.yml has no undo; rename is
 * atomic on the same filesystem and a crash leaves the previous file intact.
 */
export async function writeMeta(
  slug: string,
  meta: OpportunityMeta,
  root?: string
): Promise<void> {
  const paths = opportunityPaths(slug, root);
  /*
   * Normalize first, then read the cache off the normalized list. Deriving from
   * the raw history would take the last *appended* entry rather than the latest
   * one in time, so a backdated write would cache the wrong status.
   *
   * The cache follows the last recorded entry: a booked interview is not yet
   * the opportunity's status.
   */
  const history = normalizeHistory(meta.history);
  const withCache: OpportunityMeta = {
    ...meta,
    history,
    status: currentStatus({ ...meta, history }) ?? meta.status,
  };

  const temp = `${paths.meta}.${process.pid}.tmp`;
  await writeFile(temp, stringify(withCache), "utf8");
  try {
    await rename(temp, paths.meta);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export interface AppendStatusInput {
  status: Status;
  note?: string;
  label?: string;
  /** Override the auto-assigned round. Rarely needed; the store counts passes itself. */
  round?: number;
  outcome?: StatusEvent["outcome"];
  /** Defaults to now. Backdate a status that was reached before it was typed in. */
  at?: Date | string;
  /** `scheduled` books a commitment instead of recording a fact. */
  state?: EventState;
  /** Freeform expectation, only for a scheduled entry. */
  eta?: string;
}

function toIso(value: Date | string | undefined, fallback = new Date()): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new Error(`Unrecognized date: ${value}`);
    return parsed.toISOString();
  }
  return fallback.toISOString();
}

/**
 * Appends a status entry, recorded or scheduled.
 *
 * Appending never rewrites an existing entry. `updateEvent` exists for genuine
 * corrections and stamps what it touches, so a fixed typo stays distinguishable
 * from a fact that was always there.
 */
export async function appendStatus(
  slug: string,
  input: AppendStatusInput,
  root?: string
): Promise<Opportunity> {
  const existing = await readOpportunity(slug, root);
  const history = [...existing.meta.history];

  const state: EventState = input.state ?? "recorded";
  const round = input.round ?? nextRound(history, input.status);

  const event: StatusEvent = {
    at: toIso(input.at),
    status: input.status,
    state,
    ...(round === undefined ? {} : { round }),
    ...(input.eta ? { eta: input.eta } : {}),
    ...(input.label ? { label: input.label } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.outcome ? { outcome: input.outcome } : {}),
  };

  if (event.outcome && event.status !== "closed") {
    throw new Error("outcome is only meaningful on a closed event");
  }
  if (event.eta && state === "recorded") {
    throw new Error("eta is only meaningful on a scheduled or pending event");
  }

  history.push(event);
  return persist(slug, existing, history, root);
}

export interface UpdateEventInput {
  status?: Status;
  at?: Date | string;
  label?: string | null;
  note?: string | null;
  eta?: string | null;
  outcome?: StatusEvent["outcome"] | null;
  round?: number | null;
  /** Flip a scheduled entry to recorded — the manual "it happened" mark. */
  state?: EventState;
}

/**
 * Edits one history entry in place, addressed by its index in the stored list.
 *
 * Editing is a deliberate exception to the append-only rule: entries are typed
 * in after the fact, and a wrong date or a typo should be fixable without
 * leaving a correction event that reads like a real status change. Anything
 * edited gains `revised_at`, so a corrected entry never silently poses as an
 * original observation. A `null` in the patch clears that field.
 */
export async function updateEvent(
  slug: string,
  index: number,
  patch: UpdateEventInput,
  root?: string
): Promise<Opportunity> {
  const existing = await readOpportunity(slug, root);
  const history = [...existing.meta.history];

  if (!Number.isInteger(index) || index < 0 || index >= history.length) {
    throw new Error(`No history entry at index ${index}`);
  }

  const before = history[index];
  const next: StatusEvent = { ...before };

  if (patch.status !== undefined) next.status = patch.status;
  if (patch.at !== undefined) next.at = toIso(patch.at);
  if (patch.state !== undefined) next.state = patch.state;

  const assign = <K extends "label" | "note" | "eta">(key: K, value: string | null | undefined) => {
    if (value === undefined) return;
    if (value === null || value.trim() === "") delete next[key];
    else next[key] = value.trim();
  };
  assign("label", patch.label);
  assign("note", patch.note);
  assign("eta", patch.eta);

  if (patch.outcome !== undefined) {
    if (patch.outcome === null) delete next.outcome;
    else next.outcome = patch.outcome;
  }
  if (patch.round !== undefined) {
    if (patch.round === null) delete next.round;
    else next.round = patch.round;
  }

  if (next.outcome && next.status !== "closed") {
    throw new Error("outcome is only meaningful on a closed event");
  }
  /* Completing an entry drops the expectation; it is now a fact. */
  if (next.state === "recorded") delete next.eta;

  next.revised_at = new Date().toISOString();
  history[index] = next;

  return persist(slug, existing, history, root);
}

/** Removes one entry. Used for a booking that was cancelled outright. */
export async function removeEvent(
  slug: string,
  index: number,
  root?: string
): Promise<Opportunity> {
  const existing = await readOpportunity(slug, root);
  const history = [...existing.meta.history];
  if (!Number.isInteger(index) || index < 0 || index >= history.length) {
    throw new Error(`No history entry at index ${index}`);
  }
  history.splice(index, 1);
  return persist(slug, existing, history, root);
}

async function persist(
  slug: string,
  existing: Opportunity,
  history: StatusEvent[],
  root?: string
): Promise<Opportunity> {
  const sorted = normalizeHistory(history);
  const meta: OpportunityMeta = {
    ...existing.meta,
    history: sorted,
    status: currentStatus({ ...existing.meta, history: sorted }),
  };
  await writeMeta(slug, meta, root);
  return { ...existing, meta, issues: [] };
}

export {
  currentEvent,
  currentStatus,
  currentRound,
  rounds,
  recordedEvents,
  scheduledEvents,
  pendingEvents,
  openEvents,
  nextScheduled,
  nextAction,
  awaitingCandidate,
  idleDays,
  isStalled,
} from "./derive.js";
