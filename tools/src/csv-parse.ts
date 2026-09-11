import { basename } from "node:path";
import XLSX from "xlsx";

export interface ParsedSheet {
  name: string;
  rowCount: number;
  rows: Record<string, string | number | boolean | null>[];
}

export interface ParsedTabular {
  source: string;
  sheets: ParsedSheet[];
}

function toSheets(workbook: XLSX.WorkBook): ParsedSheet[] {
  return workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number | boolean | null>>(
      worksheet,
      { defval: "" }
    );
    return { name, rowCount: rows.length, rows };
  });
}

export function parseTabular(filePath: string): ParsedTabular {
  const workbook = XLSX.readFile(filePath, { raw: true });

  return {
    source: basename(filePath),
    sheets: toSheets(workbook),
  };
}

/**
 * Same as `parseTabular`, but for delimited text already in memory. Used when
 * the on-disk file needs preprocessing before parsing — e.g. a LinkedIn export
 * CSV whose real header row sits below a preamble of free-text notes.
 */
export function parseDelimitedText(text: string, source: string): ParsedTabular {
  const workbook = XLSX.read(text, { type: "string", raw: true });

  return {
    source,
    sheets: toSheets(workbook),
  };
}
