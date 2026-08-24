import { loadYaml } from "../yaml.js";
import { validateCandidateProfile } from "./validate.js";

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    process.stderr.write("Usage: profile-validate <profile.yml>\n");
    process.exitCode = 1;
    return;
  }

  const data = await loadYaml(inputPath);
  const result = validateCandidateProfile(data);

  if (result.ok) {
    process.stdout.write(`OK: ${inputPath} is a valid Candidate Profile\n`);
    return;
  }

  process.stderr.write(`INVALID: ${inputPath}\n`);
  for (const issue of result.issues) {
    process.stderr.write(`  ${issue.path || "(root)"}: ${issue.message}\n`);
  }
  process.exitCode = 1;
}

main();
