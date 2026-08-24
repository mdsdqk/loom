import { z } from "zod";

/**
 * Shapes for the judgment half of grounding evals (ADR 0003): the
 * deterministic half already exists (profile/validate.ts,
 * master-resume/validate.ts). This covers what gets handed to a separate
 * judge agent invocation, and what's expected back from it. Actually
 * *calling* the judge is SKILL.md's job (a subagent dispatch) -- there's
 * nothing in @loom/tools that invokes a model.
 */

export const JudgeVerdictValue = z.enum(["supported", "unsupported", "ambiguous", "contradicted"]);

export const JudgeBatchItem = z.object({
  output_path: z.string().min(1),
  claim_text: z.string().min(1),
  evidence: z.array(z.object({ id: z.string(), statement: z.string() })),
  sources: z.array(z.object({ ref: z.string(), text: z.string() })),
});

export const JudgeVerdict = z.object({
  output_path: z.string().min(1),
  verdict: JudgeVerdictValue,
  evidence_ids: z.array(z.string()),
  source_refs: z.array(z.string()),
  explanation: z.string().min(1),
});

export const JudgeResponse = z.object({
  verdicts: z.array(JudgeVerdict),
  overall: z.enum(["pass", "fail"]),
});

export type JudgeVerdictValue = z.infer<typeof JudgeVerdictValue>;
export type JudgeBatchItem = z.infer<typeof JudgeBatchItem>;
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;
export type JudgeResponse = z.infer<typeof JudgeResponse>;

/** Validates a judge's raw response before trusting it -- it's LLM output, never assumed well-formed. */
export function parseJudgeResponse(data: unknown): JudgeResponse {
  return JudgeResponse.parse(data);
}
