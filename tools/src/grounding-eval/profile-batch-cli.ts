import { join } from "node:path";
import { CandidateProfile } from "../profile/schema.js";
import { validateCandidateProfile } from "../profile/validate.js";
import { loadManifest } from "../source-normalization/manifest.js";
import { NormalizedSource } from "../source-normalization/schema.js";
import { indexAllRunTranscripts, loadAllRunTranscripts } from "../transcript.js";
import { emitYaml, loadYaml } from "../yaml.js";
import { buildProfileGroundingBatches } from "./batch.js";

async function main(): Promise<void> {
  const [profilePath, sourcesDir, runsDir] = process.argv.slice(2);
  if (!profilePath || !sourcesDir || !runsDir) {
    process.stderr.write("Usage: profile-grounding-batches <profile.yml> <sources-dir> <runs-dir>\n");
    process.stderr.write(
      "  runs-dir is candidate/profile-build/runs/ (the parent of every {run-id}/ directory, not one\n" +
        "  specific run) -- a profile's transcript: refs can cite any prior run, not just the one in\n" +
        "  progress, so every run's session.yml (for run_id) and transcript.jsonl get indexed together.\n"
    );
    process.exitCode = 1;
    return;
  }

  const profileData = await loadYaml(profilePath);
  const validation = validateCandidateProfile(profileData);
  if (!validation.ok) {
    process.stderr.write(`INVALID: ${profilePath} -- fix schema issues before building grounding batches\n`);
    for (const issue of validation.issues) {
      process.stderr.write(`  ${issue.path || "(root)"}: ${issue.message}\n`);
    }
    process.exitCode = 1;
    return;
  }
  const profile = CandidateProfile.parse(profileData);

  const manifest = await loadManifest(join(sourcesDir, "source-manifest.yml"));
  const sources: NormalizedSource[] = [];
  for (const entry of manifest.sources) {
    sources.push(NormalizedSource.parse(await loadYaml(entry.normalized_path)));
  }

  const transcriptIndex = indexAllRunTranscripts(await loadAllRunTranscripts(runsDir));

  const batches = buildProfileGroundingBatches(profile, sources, transcriptIndex);
  await emitYaml("grounding-batches", { batches }, { stdout: true });
}

main();
