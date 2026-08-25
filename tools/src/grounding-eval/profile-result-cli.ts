import { CandidateProfile } from "../profile/schema.js";
import { validateCandidateProfile } from "../profile/validate.js";
import { buildProfileSourceRefResolver } from "../resolve-context.js";
import { loadYaml, emitYaml } from "../yaml.js";
import { buildProfileGroundingBatches } from "./batch.js";
import { parseJudgeResponse } from "./schema.js";
import { combineGroundingResult } from "./result.js";

async function main(): Promise<void> {
  const [profilePath, judgeResponsePath, sourcesDir, runsDir] = process.argv.slice(2);
  if (!profilePath || !judgeResponsePath) {
    process.stderr.write("Usage: profile-grounding-result <profile.yml> <judge-response.yml> [sources-dir] [runs-dir]\n");
    process.exitCode = 1;
    return;
  }

  // A schema-invalid profile never reaches the grounding eval per EVAL.md's
  // ordering, but this CLI doesn't assume that was honored -- it re-checks
  // rather than trusting the caller got the order right. sources-dir/runs-dir
  // are optional here for the same reason as profile-validate: omitting
  // either just skips dangling-ref checking for that ref kind. runs-dir is
  // candidate/profile-build/runs/ (the parent of every {run-id}/ directory).
  const profileData = await loadYaml(profilePath);
  const resolveSourceRef = await buildProfileSourceRefResolver(sourcesDir, runsDir);
  const validation = validateCandidateProfile(profileData, resolveSourceRef ? { resolveSourceRef } : {});

  // Rebuilds the expected batch list independently of the deterministic
  // issues above, so coverage checking (did the judge return a verdict for
  // every claim that was actually sent?) still runs even when there were
  // dangling-ref issues -- both get reported together. Real source/
  // transcript text isn't needed here, only each claim's output_path, so
  // this doesn't need sources-dir/run-dir to have been given.
  const parsedProfile = CandidateProfile.safeParse(profileData);
  const expectedBatches = parsedProfile.success
    ? buildProfileGroundingBatches(parsedProfile.data, [], new Map())
    : [];

  const judgeResponse = parseJudgeResponse(await loadYaml(judgeResponsePath));
  const result = combineGroundingResult(validation.issues, expectedBatches, judgeResponse);

  await emitYaml("profile-eval-result", result, { stdout: true });
  process.exitCode = result.ok ? 0 : 1;
}

main();
