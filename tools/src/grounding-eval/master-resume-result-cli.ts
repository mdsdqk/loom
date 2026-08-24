import { CandidateProfile } from "../profile/schema.js";
import { validateCandidateProfile } from "../profile/validate.js";
import { MasterResume } from "../master-resume/schema.js";
import { validateMasterResume } from "../master-resume/validate.js";
import { loadYaml, emitYaml } from "../yaml.js";
import { parseJudgeResponse } from "./schema.js";
import { combineGroundingResult } from "./result.js";

async function main(): Promise<void> {
  const [resumePath, profilePath, judgeResponsePath] = process.argv.slice(2);
  if (!resumePath || !profilePath || !judgeResponsePath) {
    process.stderr.write("Usage: master-resume-grounding-result <resume.yml> <profile.yml> <judge-response.yml>\n");
    process.exitCode = 1;
    return;
  }

  const profileData = await loadYaml(profilePath);
  const profileValidation = validateCandidateProfile(profileData);
  if (!profileValidation.ok) {
    await emitYaml("master-resume-eval-result", profileValidation, { stdout: true });
    process.exitCode = 1;
    return;
  }
  const profile = CandidateProfile.parse(profileData);

  const resumeData = await loadYaml(resumePath);
  const structural = MasterResume.safeParse(resumeData);
  const deterministicIssues = structural.success
    ? validateMasterResume(resumeData, profile).issues
    : structural.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));

  const judgeResponse = parseJudgeResponse(await loadYaml(judgeResponsePath));
  const result = combineGroundingResult(deterministicIssues, judgeResponse);

  await emitYaml("master-resume-eval-result", result, { stdout: true });
  process.exitCode = result.ok ? 0 : 1;
}

main();
