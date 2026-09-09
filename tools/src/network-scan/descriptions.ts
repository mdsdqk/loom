import { createReadStream } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

/**
 * Full job description text, stored beside the job index rather than inside it.
 *
 * Descriptions are the bulk of a scan by size — around 8KB of plain text each,
 * roughly 126MB across a full run — while the job index is the part every stage
 * reads and re-reads. Keeping them in `jobs.yml` would make loading the index
 * cost a hundred megabytes of YAML parsing for stages that never look at a
 * description.
 *
 * They are also the part later matching depends on most, so they are stored
 * **complete**. Truncating at ingestion throws away text already paid for and
 * cannot be undone without refetching every posting; measured against one real
 * board, a 4000-character cap discarded more than half of every description,
 * including the requirements sections a matcher most needs.
 *
 * JSON Lines: appendable during a run, streamable when read, and one bad line
 * cannot corrupt the rest of the file.
 */

export interface DescriptionRecord {
  /** The `Job.id` this text belongs to. */
  id: string;
  text: string;
}

/** Appends description records, creating the file and its directory as needed. */
export async function appendDescriptions(
  path: string,
  records: DescriptionRecord[]
): Promise<void> {
  if (records.length === 0) return;

  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a");
  try {
    // One write for the batch: a per-record write would fsync thousands of times.
    await handle.write(records.map((record) => `${JSON.stringify(record)}\n`).join(""));
  } finally {
    await handle.close();
  }
}

/** Replaces the store, used when a run starts fresh rather than resuming. */
export async function resetDescriptions(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "w");
  await handle.close();
}

/**
 * Streams the store back as job id → text.
 *
 * Reads line by line rather than loading the file, since the whole point of the
 * sidecar is that it is too large to want in memory all at once.
 */
export async function loadDescriptions(path: string): Promise<Map<string, string>> {
  const descriptions = new Map<string, string>();

  let stream;
  try {
    stream = createReadStream(path, { encoding: "utf8" });
  } catch {
    return descriptions;
  }

  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as DescriptionRecord;
        if (record?.id && typeof record.text === "string") {
          descriptions.set(record.id, record.text);
        }
      } catch {
        // A single malformed line loses one description, not the file.
      }
    }
  } catch {
    return descriptions;
  }

  return descriptions;
}
