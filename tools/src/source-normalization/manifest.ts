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
 * reference across a set of normalized sources. Pass the result to
 * validateCandidateProfile's `resolveSourceRef` option (profile/validate.ts)
 * to actually check for dangling Source References — that hook was left
 * unwired when the validator was built, pending this piece.
 *
 * Covers only `source:` refs. `transcript:{run-id}#{event-id}` refs point
 * into a run's transcript.jsonl, which isn't something source
 * normalization produces — that's session/transcript tooling, not built
 * yet.
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

export function createSourceRefResolver(index: Set<string>): (ref: string) => boolean {
  return (ref) => (ref.startsWith("source:") ? index.has(ref) : true);
}
