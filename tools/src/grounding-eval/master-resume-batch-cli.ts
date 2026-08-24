import { CandidateProfile } from "../profile/schema.js";
import { validateCandidateProfile } from "../profile/validate.js";
import { MasterResume } from "../master-resume/schema.js";
import { emitYaml, loadYaml } from "../yaml.js";
import { buildMasterResumeGroundingBatches } from "./batch.js";

async function main(): Promise<void> {
  const [resumePath, profilePath] = process.argv.slice(2);
  if (!resumePath || !profilePath) {
    process.stderr.write("Usage: master-resume-grounding-batches <resume.yml> <profile.yml>\n");
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

  const batches = buildMasterResumeGroundingBatches(resume, profile);
  await emitYaml("grounding-batches", { batches }, { stdout: true });
}

main();
