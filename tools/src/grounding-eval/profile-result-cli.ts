import { validateCandidateProfile } from "../profile/validate.js";
import { loadYaml, emitYaml } from "../yaml.js";
import { parseJudgeResponse } from "./schema.js";
import { combineGroundingResult } from "./result.js";

async function main(): Promise<void> {
  const [profilePath, judgeResponsePath] = process.argv.slice(2);
  if (!profilePath || !judgeResponsePath) {
    process.stderr.write("Usage: profile-grounding-result <profile.yml> <judge-response.yml>\n");
    process.exitCode = 1;
    return;
  }

  // A schema-invalid profile never reaches the grounding eval per EVAL.md's
  // ordering, but this CLI doesn't assume that was honored -- it re-checks
  // rather than trusting the caller got the order right.
  const validation = validateCandidateProfile(await loadYaml(profilePath));
  const judgeResponse = parseJudgeResponse(await loadYaml(judgeResponsePath));
  const result = combineGroundingResult(validation.issues, judgeResponse);

  await emitYaml("profile-eval-result", result, { stdout: true });
  process.exitCode = result.ok ? 0 : 1;
}

main();
