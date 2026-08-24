import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseTabular } from "../csv-parse.js";
import { parsePdf } from "../pdf-parse.js";
import { emitYaml } from "../yaml.js";
import { appendManifestEntry } from "./manifest.js";
import { normalizeLinkedInCsvSource, normalizeTextSource, paragraphsFromParsedPdf, paragraphsFromText } from "./normalize.js";
import type { SourceType } from "./schema.js";

interface CliArgs {
  runId: string;
  sourceId: string;
  type: SourceType;
  importPath: string;
  sourcesDir: string;
  manifestPath: string;
}

const TYPE_FLAG_MAP: Record<string, SourceType> = {
  "resume-markdown": "resume_markdown",
  "resume-pdf": "resume_pdf",
  "linkedin-csv": "linkedin_csv",
};

function parseArgs(argv: string[]): CliArgs {
  let runId: string | undefined;
  let sourceId: string | undefined;
  let type: SourceType | undefined;
  let sourcesDir = "candidate/sources";
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run") runId = argv[++i];
    else if (arg === "--source-id") sourceId = argv[++i];
    else if (arg === "--type") {
      const flag = argv[++i];
      const mapped = TYPE_FLAG_MAP[flag];
      if (!mapped) throw new Error(`--type must be one of ${Object.keys(TYPE_FLAG_MAP).join(", ")}`);
      type = mapped;
    } else if (arg === "--sources-dir") sourcesDir = argv[++i];
    else positional.push(arg);
  }

  const importPath = positional[0];
  if (!runId || !sourceId || !type || !importPath) {
    throw new Error(
      "Usage: source-normalize --run <run-id> --source-id <id> --type <resume-markdown|resume-pdf|linkedin-csv> [--sources-dir <dir>] <import-path>"
    );
  }

  return { runId, sourceId, type, importPath, sourcesDir, manifestPath: join(sourcesDir, "source-manifest.yml") };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const normalizedSource = await (async () => {
    switch (args.type) {
      case "resume_markdown": {
        const text = await readFile(args.importPath, "utf8");
        return normalizeTextSource(args.runId, args.sourceId, "resume_markdown", args.importPath, paragraphsFromText(text));
      }
      case "resume_pdf": {
        const pdf = await parsePdf(args.importPath);
        return normalizeTextSource(args.runId, args.sourceId, "resume_pdf", args.importPath, paragraphsFromParsedPdf(pdf));
      }
      case "linkedin_csv": {
        const tabular = parseTabular(args.importPath);
        return normalizeLinkedInCsvSource(args.runId, args.sourceId, args.importPath, tabular);
      }
    }
  })();

  const normalizedPath = join(args.sourcesDir, `${args.runId}--${args.sourceId}.yml`);
  await emitYaml(normalizedPath, normalizedSource, { outPath: normalizedPath });

  await appendManifestEntry(args.manifestPath, {
    run_id: args.runId,
    source_id: args.sourceId,
    source_type: args.type,
    original_path: args.importPath,
    normalized_path: normalizedPath,
  });

  process.stdout.write(
    `Wrote ${normalizedPath} (${normalizedSource.records.length} records), updated ${args.manifestPath}\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
