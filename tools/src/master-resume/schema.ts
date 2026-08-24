import { z } from "zod";
import { Slug, StructuredDate } from "../profile/schema.js";

/**
 * Runtime schema + inferred types for a Master Resume
 * (`candidate/tracks/{track}/resume.yml`), per the plan's Master Resume
 * example and its grounding rule: generated prose needs Evidence Claim
 * IDs; structured facts copied without rewriting need a `profile_ref` and
 * must match the referenced Candidate Profile record exactly (checked in
 * ./validate.ts against an actual Candidate Profile, not here — this file
 * only checks the Master Resume's own shape).
 *
 * `projects` and `recognition` shapes aren't shown in the plan's YAML
 * example — it only says "the same rule applies to project descriptions
 * and recognition" — so these follow the same prose-field pattern as
 * `summary`/`intro`/bullets. `track_id` also isn't in the plan's example;
 * added so a resume can be validated on its own without relying on its
 * file path (`candidate/tracks/{track}/resume.yml`) to know which track
 * it's for. Flag if either of these should go.
 */

export const ProseField = z.object({
  text: z.string().min(1),
  evidence_ids: z.array(Slug).min(1),
});

export const Bullet = z.object({
  text: z.string().min(1),
  emphasis: z.enum(["high", "medium", "low"]),
  tags: z.array(z.string()),
  evidence_ids: z.array(Slug).min(1),
});

export const MasterResumeIdentity = z.object({
  profile_ref: z.string().min(1),
  name: z.string().min(1),
  location: z.string().optional(),
  contact: z.record(z.string(), z.string()).optional(),
});

export const MasterResumeExperience = z.object({
  id: Slug,
  profile_ref: z.string().min(1),
  company: z.string().min(1),
  role: z.string().min(1),
  dates: StructuredDate,
  intro: ProseField.optional(),
  bullets: z.array(Bullet),
});

export const MasterResumeProject = z.object({
  id: Slug,
  name: z.string().min(1),
  description: ProseField.optional(),
});

export const MasterResumeRecognitionItem = z.object({
  id: Slug,
  text: z.string().min(1),
  evidence_ids: z.array(Slug).min(1),
});

export const MasterResumeSkill = z.object({
  id: Slug,
  profile_ref: z.string().min(1),
  name: z.string().min(1),
});

export const Presentation = z.object({
  target_pages: z.number().int().positive(),
});

const MasterResumeShape = z.object({
  schema_version: z.literal(1),
  track_id: Slug,
  identity: MasterResumeIdentity,
  summary: ProseField,
  experience: z.array(MasterResumeExperience),
  projects: z.array(MasterResumeProject),
  skills: z.array(MasterResumeSkill),
  recognition: z.array(MasterResumeRecognitionItem),
  presentation: Presentation,
});

function collectDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

export const MasterResume = MasterResumeShape.superRefine((resume, ctx) => {
  for (const duplicate of collectDuplicates(resume.experience.map((entry) => entry.id))) {
    ctx.addIssue({ code: "custom", path: ["experience"], message: `duplicate experience id: ${duplicate}` });
  }
  for (const duplicate of collectDuplicates(resume.projects.map((entry) => entry.id))) {
    ctx.addIssue({ code: "custom", path: ["projects"], message: `duplicate project id: ${duplicate}` });
  }
  for (const duplicate of collectDuplicates(resume.skills.map((entry) => entry.id))) {
    ctx.addIssue({ code: "custom", path: ["skills"], message: `duplicate skill id: ${duplicate}` });
  }
  for (const duplicate of collectDuplicates(resume.recognition.map((entry) => entry.id))) {
    ctx.addIssue({ code: "custom", path: ["recognition"], message: `duplicate recognition id: ${duplicate}` });
  }
});

export type ProseField = z.infer<typeof ProseField>;
export type Bullet = z.infer<typeof Bullet>;
export type MasterResumeIdentity = z.infer<typeof MasterResumeIdentity>;
export type MasterResumeExperience = z.infer<typeof MasterResumeExperience>;
export type MasterResumeProject = z.infer<typeof MasterResumeProject>;
export type MasterResumeRecognitionItem = z.infer<typeof MasterResumeRecognitionItem>;
export type MasterResumeSkill = z.infer<typeof MasterResumeSkill>;
export type Presentation = z.infer<typeof Presentation>;
export type MasterResume = z.infer<typeof MasterResume>;

/** Parses `unknown` input into a typed, structurally-valid Master Resume (own shape only — no cross-reference against a Candidate Profile; see validate.ts). */
export function parseMasterResume(data: unknown): MasterResume {
  return MasterResume.parse(data);
}
