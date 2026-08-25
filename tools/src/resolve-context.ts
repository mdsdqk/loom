import { join } from "node:path";
import { buildSourceRefIndex, loadManifest } from "./source-normalization/manifest.js";
import { NormalizedSource } from "./source-normalization/schema.js";
import { buildAllRunsTranscriptRefIndex, loadAllRunTranscripts } from "./transcript.js";
import { loadYaml } from "./yaml.js";

/**
 * Builds a `resolveSourceRef` function (for `validateCandidateProfile`'s
 * option of the same name) covering both `source:` and `transcript:`
 * refs, from a normalized-sources directory and/or a Profile Build
 * `runs/` directory (the parent containing every `{run-id}/` subdirectory,
 * not one specific run — a profile's `transcript:` refs can point at any
 * prior run, not just the one currently in progress). Either may be
 * omitted to skip that ref kind's dangling-reference checking entirely —
 * a ref of the omitted kind resolves as valid rather than being checked
 * against an empty index, which would fail every ref of that kind instead
 * of skipping the check as documented. Omitting both returns `undefined`,
 * so the caller can pass it straight through to `validateCandidateProfile`
 * without an extra branch.
 */
export async function buildProfileSourceRefResolver(
  sourcesDir: string | undefined,
  runsDir: string | undefined
): Promise<((ref: string) => boolean) | undefined> {
  if (!sourcesDir && !runsDir) return undefined;

  let sourceRefs: Set<string> | undefined;
  if (sourcesDir) {
    const manifest = await loadManifest(join(sourcesDir, "source-manifest.yml"));
    const sources: NormalizedSource[] = [];
    for (const entry of manifest.sources) {
      sources.push(NormalizedSource.parse(await loadYaml(entry.normalized_path)));
    }
    sourceRefs = buildSourceRefIndex(sources);
  }

  let transcriptRefs: Set<string> | undefined;
  if (runsDir) {
    transcriptRefs = buildAllRunsTranscriptRefIndex(await loadAllRunTranscripts(runsDir));
  }

  return (ref: string): boolean => {
    if (ref.startsWith("transcript:")) return transcriptRefs ? transcriptRefs.has(ref) : true;
    return sourceRefs ? sourceRefs.has(ref) : true;
  };
}
