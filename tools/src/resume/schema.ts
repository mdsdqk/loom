import { z } from "zod";

/**
 * Runtime schema + inferred types for the standalone `resume.yml` artifact
 * consumed by the resume-artifact tool (create-opportunity / build-resume).
 *
 * This is deliberately a plain, self-contained resume shape — no evidence
 * IDs, no profile_ref cross-checking, no grounding. The validated,
 * Zod-inferred `Resume` type below *is* the IR: it goes straight into the
 * Nunjucks template with no separate serialized intermediate.
 */

export const ResumeMetadataSchema = z.object({
  name: z.string().min(1),
  headline: z.string().min(1),
  location: z.string().min(1),
  site: z.string().optional(),
  site_display: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().min(1),
  email_display: z.string().optional(),
  linkedin: z.string().optional(),
  linkedin_display: z.string().optional(),
  github: z.string().optional(),
  github_display: z.string().optional(),
  relocation: z.string().optional(),
});

export const ExperienceSchema = z.object({
  company: z.string().min(1),
  product: z.string().optional(),
  qualifier: z.string().optional(),
  roles: z.array(z.string().min(1)).min(1),
  dates: z.string().min(1),
  technologies: z.array(z.string()).default([]),
  location: z.string().optional(),
  introduction: z.string().optional(),
  bullets: z.array(z.string().min(1)).default([]),
});

export const SkillGroupSchema = z.object({
  name: z.string().min(1),
  items: z.array(z.string().min(1)).min(1),
});

export const ProjectSchema = z.object({
  name: z.string().min(1),
  subtitle: z.string().optional(),
  live: z.string().optional(),
  repo: z.string().optional(),
  technologies: z.array(z.string()).default([]),
  bullets: z.array(z.string().min(1)).default([]),
});

export const EducationSchema = z.object({
  institution: z.string().min(1),
  degree: z.string().min(1),
  dates: z.string().min(1),
});

export const ResumeSchema = z.object({
  metadata: ResumeMetadataSchema,
  summary: z.string().min(1),
  experience: z.array(ExperienceSchema).min(1),
  skills: z.array(SkillGroupSchema).default([]),
  projects: z.array(ProjectSchema).default([]),
  education: z.array(EducationSchema).default([]),
  recognition: z.array(z.string()).default([]),
});

export type ResumeMetadata = z.infer<typeof ResumeMetadataSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type SkillGroup = z.infer<typeof SkillGroupSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Education = z.infer<typeof EducationSchema>;
export type Resume = z.infer<typeof ResumeSchema>;

export interface ResumeValidationIssue {
  path: string;
  message: string;
}

export interface ResumeValidationResult {
  ok: boolean;
  issues: ResumeValidationIssue[];
}

/** Validates `unknown` (already YAML-parsed) data against the resume shape, returning human-readable path+message issues instead of throwing. */
export function validateResume(data: unknown): ResumeValidationResult {
  const result = ResumeSchema.safeParse(data);
  if (result.success) {
    return { ok: true, issues: [] };
  }
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
    message: issue.message,
  }));
  return { ok: false, issues };
}
