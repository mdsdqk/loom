import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseDelimitedText } from "../../csv-parse.js";

export type ExportRow = Record<string, string>;

/**
 * Reads one CSV out of a LinkedIn data export.
 *
 * LinkedIn prefixes some files (notably `Connections.csv`) with a few lines of
 * free-text notes before the real header row, which defeats a straight CSV
 * parse. Rather than hard-coding a skip count that varies by file and by export
 * vintage, this locates the header by looking for a row containing an expected
 * column name and parses from there.
 */
export async function readExportCsv(
  filePath: string,
  expectedColumn: string
): Promise<ExportRow[] | null> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return null;
  }

  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = withoutBom.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.includes(expectedColumn));
  if (headerIndex === -1) return null;

  const parsed = parseDelimitedText(lines.slice(headerIndex).join("\n"), basename(filePath));
  const rows = parsed.sheets[0]?.rows ?? [];

  return rows.map((row) => {
    const normalized: ExportRow = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key.trim()] = value === null || value === undefined ? "" : String(value).trim();
    }
    return normalized;
  });
}

/** The export files this pipeline reads, and the column that identifies each header row. */
export const EXPORT_FILES = {
  connections: { path: "Connections.csv", column: "First Name" },
  companyFollows: { path: "Company Follows.csv", column: "Organization" },
  positions: { path: "Positions.csv", column: "Company Name" },
  education: { path: "Education.csv", column: "School Name" },
  savedJobs: { path: join("Jobs", "Saved Jobs.csv"), column: "Company Name" },
  jobPreferences: { path: join("Jobs", "Job Seeker Preferences.csv"), column: "Job Titles" },
} as const;

export type ExportFileKey = keyof typeof EXPORT_FILES;

export interface LoadedExport {
  rows: Partial<Record<ExportFileKey, ExportRow[]>>;
  missing: string[];
}

/** Loads every known export file, recording which ones were absent. */
export async function loadExport(exportDir: string): Promise<LoadedExport> {
  const rows: Partial<Record<ExportFileKey, ExportRow[]>> = {};
  const missing: string[] = [];

  for (const [key, spec] of Object.entries(EXPORT_FILES) as [
    ExportFileKey,
    (typeof EXPORT_FILES)[ExportFileKey],
  ][]) {
    const parsed = await readExportCsv(join(exportDir, spec.path), spec.column);
    if (parsed === null) {
      missing.push(spec.path);
    } else {
      rows[key] = parsed;
    }
  }

  return { rows, missing };
}
