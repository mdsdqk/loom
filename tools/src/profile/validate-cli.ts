import { buildProfileSourceRefResolver } from "../resolve-context.js";
import { loadYaml } from "../yaml.js";
import { validateCandidateProfile } from "./validate.js";

async function main(): Promise<void> {
  const [inputPath, sourcesDir, runsDir] = process.argv.slice(2);
  if (!inputPath) {
    process.stderr.write("Usage: profile-validate <profile.yml> [sources-dir] [runs-dir]\n");
    process.stderr.write(
      "  sources-dir and runs-dir are both optional, but omitting either skips dangling Source Reference\n" +
        "  checking for that ref kind (source: or transcript:) -- pass both for the real promotion check.\n" +
        "  runs-dir is candidate/profile-build/runs/ (the parent of every {run-id}/ directory, not one\n" +
        "  specific run) -- a profile's transcript: refs can cite any prior run, not just the current one.\n"
    );
    process.exitCode = 1;
    return;
  }

  const data = await loadYaml(inputPath);
  const resolveSourceRef = await buildProfileSourceRefResolver(sourcesDir, runsDir);
  const result = validateCandidateProfile(data, resolveSourceRef ? { resolveSourceRef } : {});

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
