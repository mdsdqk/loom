import { join } from "node:path";
import { CandidateProfile } from "../profile/schema.js";
import { validateCandidateProfile } from "../profile/validate.js";
import { MasterResume } from "../master-resume/schema.js";
import { loadManifest } from "../source-normalization/manifest.js";
import { NormalizedSource } from "../source-normalization/schema.js";
import { indexAllRunTranscripts, loadAllRunTranscripts } from "../transcript.js";
import { emitYaml, loadYaml } from "../yaml.js";
import { buildMasterResumeGroundingBatches } from "./batch.js";

async function main(): Promise<void> {
  const [resumePath, profilePath, sourcesDir, runsDir] = process.argv.slice(2);
  if (!resumePath || !profilePath || !sourcesDir || !runsDir) {
    process.stderr.write("Usage: master-resume-grounding-batches <resume.yml> <profile.yml> <sources-dir> <runs-dir>\n");
    process.stderr.write(
      "  sources-dir and runs-dir resolve the source:/transcript: refs the resume's cited Evidence Claims\n" +
        "  point at -- without them, evidence is judged by claim statement alone, not the underlying corpus\n" +
        "  those claims themselves cite (ADR 0003, ticket 009). runs-dir is candidate/profile-build/runs/\n" +
        "  (the parent of every {run-id}/ directory) -- cited claims can originate from any prior run.\n"
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
  const resume = MasterResume.parse(await loadYaml(resumePath));

  const manifest = await loadManifest(join(sourcesDir, "source-manifest.yml"));
  const sources: NormalizedSource[] = [];
  for (const entry of manifest.sources) {
    sources.push(NormalizedSource.parse(await loadYaml(entry.normalized_path)));
  }

  const transcriptIndex = indexAllRunTranscripts(await loadAllRunTranscripts(runsDir));

  const batches = buildMasterResumeGroundingBatches(resume, profile, sources, transcriptIndex);
  await emitYaml("grounding-batches", { batches }, { stdout: true });
}

main();
