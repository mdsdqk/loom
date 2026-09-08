import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { renderResumePdf } from "./renderer.js";
import { slugify } from "./opportunity.js";
import { ResumeSchema, validateResume, type ResumeValidationIssue } from "./schema.js";
import { loadResumeYaml } from "./yaml.js";
import { parse as parseYaml } from "yaml";

export interface BuildResumeResult {
  ok: boolean;
  outPath: string;
  issues: ResumeValidationIssue[];
}

export function defaultResumePdfPath(resumePath: string, candidateName?: string, role?: string): string {
  if (!candidateName) {
    return join(dirname(resumePath), "resume.pdf");
  }

  const candidateSlug = slugify(candidateName);
  const artifactsDir = dirname(resumePath);
  const suffix = role ? `-${slugify(role)}` : "";
  return join(artifactsDir, `resume-${candidateSlug}${suffix}.pdf`);
}

async function loadMetadata(resumePath: string): Promise<{ preferredName?: string; role?: string }> {
  const artifactsDir = dirname(resumePath);
  const opportunityMetadataPath = join(artifactsDir, "..", "meta.yml");
  const candidateMetadataPath = join(artifactsDir, "..", "..", "..", "candidate", "meta.yml");

  let preferredName: string | undefined;
  let role: string | undefined;

  try {
    const opportunityMetadata = parseYaml(await readFile(opportunityMetadataPath, "utf8")) as { role?: unknown };
    role = typeof opportunityMetadata?.role === "string" ? opportunityMetadata.role : undefined;
  } catch {
    // Metadata is optional for backward compatibility with existing artifacts.
  }

  try {
    const candidateMetadata = parseYaml(await readFile(candidateMetadataPath, "utf8")) as { preferred_name?: unknown };
    preferredName = typeof candidateMetadata?.preferred_name === "string" ? candidateMetadata.preferred_name : undefined;
  } catch {
    // Metadata is optional for backward compatibility with existing resumes.
  }

  return { preferredName, role };
}

/** Loads, validates, and (only if valid) renders resume.yml to a PDF. Never touches outPath when validation fails, so a prior successful build survives. */
export async function buildResume(resumePath: string, outPath?: string): Promise<BuildResumeResult> {
  const data = await loadResumeYaml(resumePath);
  const metadata = await loadMetadata(resumePath);
  const candidateName = typeof data === "object" && data !== null && "metadata" in data
    && typeof data.metadata === "object" && data.metadata !== null && "name" in data.metadata
    && typeof data.metadata.name === "string" ? data.metadata.name : undefined;
  const resolvedOutPath = outPath ?? defaultResumePdfPath(resumePath, metadata.preferredName ?? candidateName, metadata.role);
  const validation = validateResume(data);
  if (!validation.ok) {
    return { ok: false, outPath: resolvedOutPath, issues: validation.issues };
  }
  await renderResumePdf(ResumeSchema.parse(data), resolvedOutPath);
  return { ok: true, outPath: resolvedOutPath, issues: [] };
}
