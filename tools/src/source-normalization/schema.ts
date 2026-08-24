import { z } from "zod";
import { Slug } from "../profile/schema.js";

/**
 * Runtime schema for a normalized candidate source
 * (`candidate/sources/{run-id}--{source-id}.yml`) and the per-run
 * manifest that indexes them, per the plan's "Source ingestion" section.
 *
 * The plan names this piece (source-manifest.yml, run-qualified source
 * and record IDs) but never gives a concrete record shape or says how
 * freeform text (a resume) gets chunked into individually-citable
 * records. This file's answer, entirely this file's own invention:
 * paragraph-level chunking for text sources, row-level for CSVs — see
 * normalize.ts for the reasoning. Flag if a different granularity is
 * wanted; the schema itself doesn't assume a particular chunking
 * strategy, just that each record has a stable id and citable text.
 */

export const SourceType = z.enum(["resume_markdown", "resume_pdf", "linkedin_csv"]);

export const SourceRecord = z.object({
  id: Slug,
  text: z.string().min(1),
});

const NormalizedSourceShape = z.object({
  run_id: Slug,
  source_id: Slug,
  source_type: SourceType,
  original_path: z.string().min(1),
  // Deliberately not .min(1): a source that normalizes to zero citable
  // records (e.g. every row/paragraph was blank) is a legitimate, valid,
  // if uninteresting, normalized source — not a schema error.
  records: z.array(SourceRecord),
});

export const NormalizedSource = NormalizedSourceShape.superRefine((source, ctx) => {
  const seen = new Set<string>();
  for (const record of source.records) {
    if (seen.has(record.id)) {
      ctx.addIssue({ code: "custom", path: ["records"], message: `duplicate record id within this source: ${record.id}` });
    }
    seen.add(record.id);
  }
});

export const ManifestEntry = z.object({
  run_id: Slug,
  source_id: Slug,
  source_type: SourceType,
  original_path: z.string().min(1),
  normalized_path: z.string().min(1),
});

export const SourceManifest = z.object({
  sources: z.array(ManifestEntry),
});

export type SourceType = z.infer<typeof SourceType>;
export type SourceRecord = z.infer<typeof SourceRecord>;
export type NormalizedSource = z.infer<typeof NormalizedSource>;
export type ManifestEntry = z.infer<typeof ManifestEntry>;
export type SourceManifest = z.infer<typeof SourceManifest>;
