import type { JudgeBatchItem, JudgeResponse } from "./schema.js";

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
 *
 * `batches` is the list of items that were actually sent to the judge —
 * required, not optional, because without it there was no way to detect
 * a truncated or empty judge response: `{ verdicts: [], overall: "pass" }`
 * used to satisfy this function completely, meaning a judge that skipped
 * every claim looked identical to one that reviewed everything and found
 * no problems. Every batch item now needs its own verdict, or it's
 * treated as a blocking gap, not silently ignored. `judgeResponse.overall`
 * is also checked directly now, rather than only inferred from
 * per-verdict results — a judge that declares `overall: fail` blocks even
 * if every individual verdict happens to say `supported`.
 */
export function combineGroundingResult(
  deterministicIssues: GroundingIssue[],
  batches: JudgeBatchItem[],
  judgeResponse: JudgeResponse
): GroundingResult {
  const issues: GroundingIssue[] = [...deterministicIssues];

  if (judgeResponse.overall !== "pass") {
    issues.push({ path: "(judge)", message: `judge reported overall: ${judgeResponse.overall}` });
  }

  const verdictByPath = new Map(judgeResponse.verdicts.map((verdict) => [verdict.output_path, verdict]));
  for (const batch of batches) {
    const verdict = verdictByPath.get(batch.output_path);
    if (!verdict) {
      issues.push({ path: batch.output_path, message: "judge returned no verdict for this claim" });
      continue;
    }
    if (verdict.verdict !== "supported") {
      issues.push({ path: verdict.output_path, message: `${verdict.verdict}: ${verdict.explanation}` });
    }
  }

  return { ok: issues.length === 0, issues };
}
