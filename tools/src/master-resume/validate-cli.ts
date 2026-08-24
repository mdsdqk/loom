import { CandidateProfile } from "../profile/schema.js";
import { validateCandidateProfile } from "../profile/validate.js";
import { loadYaml } from "../yaml.js";
import { validateMasterResume } from "./validate.js";

async function main(): Promise<void> {
  const [resumePath, profilePath] = process.argv.slice(2);
  if (!resumePath || !profilePath) {
    process.stderr.write("Usage: master-resume-validate <resume.yml> <profile.yml>\n");
    process.exitCode = 1;
    return;
  }

  const profileData = await loadYaml(profilePath);
  const profileResult = validateCandidateProfile(profileData);
  if (!profileResult.ok) {
    process.stderr.write(`INVALID: ${profilePath} (the Candidate Profile itself is invalid)\n`);
    for (const issue of profileResult.issues) {
      process.stderr.write(`  ${issue.path || "(root)"}: ${issue.message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const profile = CandidateProfile.parse(profileData);
  const resumeData = await loadYaml(resumePath);
  const result = validateMasterResume(resumeData, profile);

  if (result.ok) {
    process.stdout.write(`OK: ${resumePath} is valid against ${profilePath}\n`);
    return;
  }

  process.stderr.write(`INVALID: ${resumePath}\n`);
  for (const issue of result.issues) {
    process.stderr.write(`  ${issue.path || "(root)"}: ${issue.message}\n`);
  }
  process.exitCode = 1;
}

main();
