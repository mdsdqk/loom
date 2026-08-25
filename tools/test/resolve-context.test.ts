import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildProfileSourceRefResolver } from "../src/resolve-context.js";
import { appendManifestEntry } from "../src/source-normalization/manifest.js";

describe("buildProfileSourceRefResolver", () => {
  let sourcesDir: string;
  let runsDir: string;

  beforeEach(async () => {
    sourcesDir = await mkdtemp(join(tmpdir(), "loom-sources-"));
    runsDir = await mkdtemp(join(tmpdir(), "loom-runs-"));
  });

  afterEach(async () => {
    await rm(sourcesDir, { recursive: true, force: true });
    await rm(runsDir, { recursive: true, force: true });
  });

  async function writeNormalizedSource(): Promise<void> {
    const normalizedPath = join(sourcesDir, "run-a--sample-resume.yml");
    await writeFile(normalizedPath, `run_id: run-a\nsource_id: sample-resume\nsource_type: resume_markdown\noriginal_path: resume.md\nrecords:\n  - id: para-1\n    text: Alpha\n`, "utf8");
    await appendManifestEntry(join(sourcesDir, "source-manifest.yml"), {
      run_id: "run-a",
      source_id: "sample-resume",
      source_type: "resume_markdown",
      original_path: "resume.md",
      normalized_path: normalizedPath,
    });
  }

  async function writeRun(runId: string, eventId: string, text: string): Promise<void> {
    const dir = join(runsDir, runId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "session.yml"), `run_id: ${runId}\n`, "utf8");
    await writeFile(join(dir, "transcript.jsonl"), JSON.stringify({ event_id: eventId, role: "candidate", timestamp: "t", text }), "utf8");
  }

  it("returns undefined when both directories are omitted", async () => {
    expect(await buildProfileSourceRefResolver(undefined, undefined)).toBeUndefined();
  });

  it("resolves a transcript: ref from an older run while runs-dir also contains the current run -- the reconciliation case", async () => {
    await writeRun("run-a", "event-38", "Older run's statement.");
    await writeRun("run-b", "event-3", "Newer run's statement.");

    const resolve = await buildProfileSourceRefResolver(undefined, runsDir);
    expect(resolve).toBeDefined();
    expect((resolve as (ref: string) => boolean)("transcript:run-a#event-38")).toBe(true);
    expect((resolve as (ref: string) => boolean)("transcript:run-b#event-3")).toBe(true);
    expect((resolve as (ref: string) => boolean)("transcript:run-a#event-99")).toBe(false);
  });

  it("skips source: checking entirely when sources-dir is omitted -- it does not fail every source: ref closed", async () => {
    await writeRun("run-a", "event-1", "Hi.");
    const resolve = await buildProfileSourceRefResolver(undefined, runsDir);
    expect((resolve as (ref: string) => boolean)("source:run-a:sample-resume#para-1")).toBe(true);
  });

  it("skips transcript: checking entirely when runs-dir is omitted -- it does not fail every transcript: ref closed", async () => {
    await writeNormalizedSource();
    const resolve = await buildProfileSourceRefResolver(sourcesDir, undefined);
    expect((resolve as (ref: string) => boolean)("transcript:run-a#event-1")).toBe(true);
  });

  it("still rejects a dangling ref of a kind whose directory was given", async () => {
    await writeNormalizedSource();
    await writeRun("run-a", "event-1", "Hi.");
    const resolve = await buildProfileSourceRefResolver(sourcesDir, runsDir);
    expect((resolve as (ref: string) => boolean)("source:run-a:sample-resume#para-1")).toBe(true);
    expect((resolve as (ref: string) => boolean)("source:run-a:sample-resume#para-99")).toBe(false);
    expect((resolve as (ref: string) => boolean)("transcript:run-a#event-1")).toBe(true);
    expect((resolve as (ref: string) => boolean)("transcript:run-a#event-99")).toBe(false);
  });
});
