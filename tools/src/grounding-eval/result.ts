import type { JudgeResponse } from "./schema.js";

export interface GroundingIssue {
  path: string;
  message: string;
}

export interface GroundingResult {
  ok: boolean;
  issues: GroundingIssue[];
}

/**
 * Combines deterministic pre-check issues (schema/reference validation,
 * computed separately — see profile/validate.ts and
 * master-resume/validate.ts) with a judge's verdicts into one final
 * result. Only a `supported` verdict passes; `unsupported`, `ambiguous`,
 * and `contradicted` are all blocking at the same severity, per the
 * plan's "only supported passes."
 */
export function combineGroundingResult(
  deterministicIssues: GroundingIssue[],
  judgeResponse: JudgeResponse
): GroundingResult {
  const issues: GroundingIssue[] = [...deterministicIssues];
  for (const verdict of judgeResponse.verdicts) {
    if (verdict.verdict !== "supported") {
      issues.push({ path: verdict.output_path, message: `${verdict.verdict}: ${verdict.explanation}` });
    }
  }
  return { ok: issues.length === 0, issues };
}
