import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadYaml } from "./yaml.js";

export interface TranscriptEvent {
  event_id: string;
  role: string;
  timestamp: string;
  text: string;
}

function isTranscriptEvent(value: unknown): value is TranscriptEvent {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.event_id === "string" && typeof record.text === "string";
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? (error as Error & { code?: string }).code : undefined;
}

/**
 * Reads a Profile Build run's transcript.jsonl (one JSON object per line —
 * see .agents/skills/build-profile/SESSION-SCHEMA.md) into an ordered list
 * of events. A missing file reads as an empty list (a run with no
 * interview-origin claims yet has nothing to read, not an error).
 * Malformed lines are skipped rather than failing the whole read — this is
 * best-effort reading of agent-written session state, not a validated
 * contract; there's deliberately no Zod schema backing it (see
 * SESSION-SCHEMA.md for why).
 */
export async function readTranscript(transcriptPath: string): Promise<TranscriptEvent[]> {
  let text: string;
  try {
    text = await readFile(transcriptPath, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }

  const events: TranscriptEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isTranscriptEvent(parsed)) events.push(parsed);
    } catch {
      // Skip malformed lines rather than failing the whole read.
    }
  }
  return events;
}

/** Indexes transcript events by their full, run-qualified Source Reference form (`transcript:{run-id}#{event-id}`) -> event text, matching how source-normalization indexes `source:` refs. */
export function indexTranscriptEvents(runId: string, events: TranscriptEvent[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const event of events) {
    index.set(`transcript:${runId}#${event.event_id}`, event.text);
  }
  return index;
}

/** The resolvable transcript: ref keys, for dangling-reference checking (see source-normalization/manifest.ts's analogous buildSourceRefIndex/createSourceRefResolver). */
export function buildTranscriptRefIndex(runId: string, events: TranscriptEvent[]): Set<string> {
  return new Set(indexTranscriptEvents(runId, events).keys());
}

/** Reads `run_id` out of a loaded session.yml document. Throws with a clear message rather than silently proceeding with an unqualified/wrong run id. */
export function extractRunId(sessionData: unknown): string {
  if (typeof sessionData !== "object" || sessionData === null) {
    throw new Error("session.yml did not parse to an object");
  }
  const runId = (sessionData as Record<string, unknown>).run_id;
  if (typeof runId !== "string" || runId.length === 0) {
    throw new Error("session.yml is missing a valid run_id");
  }
  return runId;
}

/** Loads a Profile Build run directory's run_id (from session.yml) and transcript events (from transcript.jsonl) together — the common case every caller that needs transcript resolution actually wants. */
export async function loadRunTranscript(
  runDir: string
): Promise<{ runId: string; events: TranscriptEvent[] }> {
  const sessionData = await loadYaml(join(runDir, "session.yml"));
  const runId = extractRunId(sessionData);
  const events = await readTranscript(join(runDir, "transcript.jsonl"));
  return { runId, events };
}

/**
 * Loads every run under a Profile Build `runs/` directory (one
 * subdirectory per run), not just one. A profile citing `transcript:`
 * refs is not confined to the run currently in progress — reconciliation
 * (ADR 0005: claims are never erased, only superseded) keeps prior runs'
 * claims, and with them their original `transcript:{run-id}#{event-id}`
 * refs, so resolving those refs means indexing every run under `runs/`,
 * not just the one the current session happens to be writing to.
 *
 * A subdirectory without a valid `session.yml` is skipped rather than
 * failing the whole load — one malformed historical run shouldn't block
 * resolving references from every other run.
 */
export async function loadAllRunTranscripts(
  runsDir: string
): Promise<{ runId: string; events: TranscriptEvent[] }[]> {
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }

  const runs: { runId: string; events: TranscriptEvent[] }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      runs.push(await loadRunTranscript(join(runsDir, entry.name)));
    } catch {
      // Skip a run directory without a valid session.yml.
    }
  }
  return runs;
}

/** Merges `indexTranscriptEvents` across every loaded run into one ref -> text index, for resolving a `transcript:` ref to real text regardless of which run it originated from. */
export function indexAllRunTranscripts(runs: { runId: string; events: TranscriptEvent[] }[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const { runId, events } of runs) {
    for (const [key, value] of indexTranscriptEvents(runId, events)) index.set(key, value);
  }
  return index;
}

/** Merges `buildTranscriptRefIndex` across every loaded run into one Set, for dangling-reference checking regardless of which run a `transcript:` ref originated from. */
export function buildAllRunsTranscriptRefIndex(runs: { runId: string; events: TranscriptEvent[] }[]): Set<string> {
  const index = new Set<string>();
  for (const { runId, events } of runs) {
    for (const key of buildTranscriptRefIndex(runId, events)) index.add(key);
  }
  return index;
}
