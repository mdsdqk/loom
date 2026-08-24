import type { ParsedPdf } from "../pdf-parse.js";
import type { ParsedTabular } from "../csv-parse.js";
import { NormalizedSource, type SourceRecord } from "./schema.js";

/**
 * Splits Markdown/plain text into paragraphs on blank lines. A deliberately
 * simple, deterministic default — it doesn't understand headings, bullet
 * lists, or resume structure, it just gives every non-empty paragraph a
 * stable, citable id. Good enough to cite *something* concrete without
 * requiring AI judgment for the mechanical splitting step itself; the
 * Profile Build skill's own judgment is what decides which paragraph
 * supports which claim.
 */
export function paragraphsFromText(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

/** Flattens a parsed PDF's per-page paragraph groups (already line-clustered by pdf-parse.ts) into one paragraph-per-record list. */
export function paragraphsFromParsedPdf(pdf: ParsedPdf): string[] {
  return pdf.pages.flatMap((page) => page.paragraphs.map((lines) => lines.join(" ")));
}

export function normalizeTextSource(
  runId: string,
  sourceId: string,
  sourceType: "resume_markdown" | "resume_pdf",
  originalPath: string,
  paragraphs: string[]
): NormalizedSource {
  const records: SourceRecord[] = paragraphs.map((text, index) => ({ id: `para-${index + 1}`, text }));
  return NormalizedSource.parse({
    run_id: runId,
    source_id: sourceId,
    source_type: sourceType,
    original_path: originalPath,
    records,
  });
}

/** Renders one CSV/Excel row as citable "Key: Value" lines, skipping empty cells. */
function renderRow(row: Record<string, string | number | boolean | null>): string {
  return Object.entries(row)
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n");
}

export function normalizeLinkedInCsvSource(
  runId: string,
  sourceId: string,
  originalPath: string,
  tabular: ParsedTabular
): NormalizedSource {
  const records: SourceRecord[] = [];
  let index = 0;
  for (const sheet of tabular.sheets) {
    for (const row of sheet.rows) {
      index += 1;
      const text = renderRow(row);
      if (text.length === 0) continue;
      records.push({ id: `row-${index}`, text });
    }
  }
  return NormalizedSource.parse({
    run_id: runId,
    source_id: sourceId,
    source_type: "linkedin_csv",
    original_path: originalPath,
    records,
  });
}
