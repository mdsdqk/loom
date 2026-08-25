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

export function parseTabular(filePath: string): ParsedTabular {
  const workbook = XLSX.readFile(filePath, { raw: true });

  const sheets: ParsedSheet[] = workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number | boolean | null>>(
      worksheet,
      { defval: "" }
    );
    return { name, rowCount: rows.length, rows };
  });

  return {
    source: basename(filePath),
    sheets,
  };
}
