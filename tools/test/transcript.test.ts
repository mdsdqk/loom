import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAllRunsTranscriptRefIndex,
  buildTranscriptRefIndex,
  extractRunId,
  indexAllRunTranscripts,
  indexTranscriptEvents,
  loadAllRunTranscripts,
  loadRunTranscript,
  readTranscript,
} from "../src/transcript.js";

describe("readTranscript", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loom-transcript-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an empty list when the file doesn't exist", async () => {
    expect(await readTranscript(join(dir, "does-not-exist.jsonl"))).toEqual([]);
  });

  it("parses valid JSONL lines in order", async () => {
    const path = join(dir, "transcript.jsonl");
    await writeFile(
      path,
      [
        '{"event_id":"event-1","role":"agent","timestamp":"2026-08-24T13:05:00Z","text":"Hello"}',
        '{"event_id":"event-2","role":"candidate","timestamp":"2026-08-24T13:06:00Z","text":"Hi"}',
      ].join("\n"),
      "utf8"
    );
    const events = await readTranscript(path);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ event_id: "event-1", role: "agent", timestamp: "2026-08-24T13:05:00Z", text: "Hello" });
    expect(events[1].event_id).toBe("event-2");
  });

  it("skips malformed JSON lines rather than failing the whole read", async () => {
    const path = join(dir, "transcript.jsonl");
    await writeFile(
      path,
      ['{"event_id":"event-1","role":"agent","timestamp":"t","text":"ok"}', "not json at all", ""].join("\n"),
      "utf8"
    );
    const events = await readTranscript(path);
    expect(events).toHaveLength(1);
    expect(events[0].event_id).toBe("event-1");
  });

  it("skips well-formed JSON lines missing required fields", async () => {
    const path = join(dir, "transcript.jsonl");
    await writeFile(path, '{"role":"agent","timestamp":"t"}', "utf8");
    expect(await readTranscript(path)).toEqual([]);
  });
});

describe("indexTranscriptEvents / buildTranscriptRefIndex", () => {
  const events = [
    { event_id: "event-1", role: "agent", timestamp: "t1", text: "First" },
    { event_id: "event-2", role: "candidate", timestamp: "t2", text: "Second" },
  ];

  it("indexes events by their full run-qualified ref", () => {
    const index = indexTranscriptEvents("run-a", events);
    expect(index.get("transcript:run-a#event-1")).toBe("First");
    expect(index.get("transcript:run-a#event-2")).toBe("Second");
  });

  it("builds a Set of the same ref keys for dangling-reference checking", () => {
    const refs = buildTranscriptRefIndex("run-a", events);
    expect(refs).toEqual(new Set(["transcript:run-a#event-1", "transcript:run-a#event-2"]));
  });
});

describe("extractRunId", () => {
  it("returns run_id when present and valid", () => {
    expect(extractRunId({ run_id: "run-20260824-a" })).toBe("run-20260824-a");
  });

  it("throws when session data isn't an object", () => {
    expect(() => extractRunId("not an object")).toThrow();
    expect(() => extractRunId(null)).toThrow();
  });

  it("throws when run_id is missing or not a string", () => {
    expect(() => extractRunId({})).toThrow();
    expect(() => extractRunId({ run_id: 42 })).toThrow();
    expect(() => extractRunId({ run_id: "" })).toThrow();
  });
});

describe("loadRunTranscript", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loom-run-transcript-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads run_id from session.yml and events from transcript.jsonl together", async () => {
    await writeFile(join(dir, "session.yml"), "run_id: run-20260824-a\nstatus: in_progress\n", "utf8");
    await writeFile(
      join(dir, "transcript.jsonl"),
      '{"event_id":"event-1","role":"agent","timestamp":"t","text":"Hi"}',
      "utf8"
    );

    const { runId, events } = await loadRunTranscript(dir);
    expect(runId).toBe("run-20260824-a");
    expect(events).toHaveLength(1);
  });

  it("returns an empty event list when transcript.jsonl doesn't exist yet but session.yml does", async () => {
    await writeFile(join(dir, "session.yml"), "run_id: run-20260824-a\n", "utf8");
    const { runId, events } = await loadRunTranscript(dir);
    expect(runId).toBe("run-20260824-a");
    expect(events).toEqual([]);
  });
});

describe("loadAllRunTranscripts / indexAllRunTranscripts / buildAllRunsTranscriptRefIndex", () => {
  let runsDir: string;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "loom-runs-"));
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  async function writeRun(runId: string, eventId: string, text: string): Promise<void> {
    const dir = join(runsDir, runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "session.yml"), `run_id: ${runId}\n`, "utf8");
    await writeFile(join(dir, "transcript.jsonl"), JSON.stringify({ event_id: eventId, role: "candidate", timestamp: "t", text }), "utf8");
  }

  it("returns an empty list when the runs directory doesn't exist", async () => {
    expect(await loadAllRunTranscripts(join(runsDir, "does-not-exist"))).toEqual([]);
  });

  it("loads every run subdirectory, not just one", async () => {
    await writeRun("run-a", "event-38", "Older run's statement.");
    await writeRun("run-b", "event-3", "Newer run's statement.");

    const runs = await loadAllRunTranscripts(runsDir);
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.runId).sort()).toEqual(["run-a", "run-b"]);
  });

  it("resolves a transcript: ref from an older run even when a newer run is also present -- the reconciliation case", async () => {
    await writeRun("run-a", "event-38", "Older run's statement.");
    await writeRun("run-b", "event-3", "Newer run's statement.");

    const runs = await loadAllRunTranscripts(runsDir);
    const textIndex = indexAllRunTranscripts(runs);
    const refIndex = buildAllRunsTranscriptRefIndex(runs);

    expect(textIndex.get("transcript:run-a#event-38")).toBe("Older run's statement.");
    expect(refIndex.has("transcript:run-a#event-38")).toBe(true);
    expect(refIndex.has("transcript:run-b#event-3")).toBe(true);
    expect(refIndex.has("transcript:run-a#event-99")).toBe(false);
  });

  it("skips a run subdirectory without a valid session.yml rather than failing the whole load", async () => {
    await writeRun("run-a", "event-1", "Fine.");
    await mkdir(join(runsDir, "run-broken"), { recursive: true });
    // run-broken has no session.yml at all.

    const runs = await loadAllRunTranscripts(runsDir);
    expect(runs.map((run) => run.runId)).toEqual(["run-a"]);
  });
});
