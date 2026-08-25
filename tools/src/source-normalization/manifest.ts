import { existsSync } from "node:fs";
import { emitYaml, loadYaml } from "../yaml.js";
import { type ManifestEntry, type NormalizedSource, SourceManifest } from "./schema.js";

export async function loadManifest(manifestPath: string): Promise<SourceManifest> {
  if (!existsSync(manifestPath)) return { sources: [] };
  return SourceManifest.parse(await loadYaml(manifestPath));
}

/** Appends one entry and rewrites the manifest file in place. Every ingestion run adds new entries rather than overwriting old ones (plan: reruns create new immutable records, never overwrite prior provenance). */
export async function appendManifestEntry(manifestPath: string, entry: ManifestEntry): Promise<void> {
  const manifest = await loadManifest(manifestPath);
  manifest.sources.push(entry);
  await emitYaml(manifestPath, manifest, { outPath: manifestPath });
}

/**
 * Builds an in-memory index of every resolvable `source:{run-id}:{source-id}#{record-id}`
 * reference across a set of normalized sources. Combine with
 * `transcript.js`'s `buildTranscriptRefIndex` and pass both to
 * `createSourceRefResolver` below to get a resolver covering both ref
 * kinds — `validateCandidateProfile`'s `resolveSourceRef` option
 * (profile/validate.ts) needs the combined resolver to actually catch a
 * dangling reference of either kind.
 */
export function buildSourceRefIndex(sources: NormalizedSource[]): Set<string> {
  const index = new Set<string>();
  for (const source of sources) {
    for (const record of source.records) {
      index.add(`source:${source.run_id}:${source.source_id}#${record.id}`);
    }
  }
  return index;
}

/**
 * Builds a resolver from a `source:` ref index and (optionally) a
 * `transcript:` ref index (see `transcript.js`'s `buildTranscriptRefIndex`).
 * Fails closed: a ref not present in either index does not resolve. There
 * is deliberately no fallback that treats an unrecognized ref kind as
 * automatically valid — that was this function's original bug (every
 * `transcript:` ref silently passed regardless of whether the event
 * actually existed).
 */
export function createSourceRefResolver(
  sourceIndex: Set<string>,
  transcriptIndex: Set<string> = new Set()
): (ref: string) => boolean {
  return (ref) => sourceIndex.has(ref) || transcriptIndex.has(ref);
}
