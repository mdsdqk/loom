import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import yaml from "js-yaml";
import { runPaths } from "./paths.js";
import { buildReport } from "./report.js";
import {
  DomainsArtifactSchema,
  HiringSourcesArtifactSchema,
  JobsArtifactSchema,
  NetworkImportSchema,
} from "./schema.js";
import type { ReportInput } from "./report.js";

const program = new Command();

interface ReportCliOptions {
  candidate?: string;
  output?: string;
  stdout?: boolean;
}

/** Reads and validates an optional stage artifact; a missing stage is fine. */
async function readOptional<T>(path: string, schema: { parse: (v: unknown) => T }): Promise<T | undefined> {
  try {
    return schema.parse(yaml.load(await readFile(path, "utf8")));
  } catch {
    return undefined;
  }
}

program
  .name("network-report")
  .description("Summarize a network scan: what was found, what was lost, and where the leverage is")
  .option("-c, --candidate <dir>", "candidate workspace directory")
  .option("-o, --output <path>", "where to write the report")
  .option("--stdout", "print the report instead of writing a file")
  .action(async (options: ReportCliOptions) => {
    try {
      const paths = runPaths(options.candidate);

      const network = NetworkImportSchema.parse(
        yaml.load(await readFile(paths.networkImport, "utf8"))
      );

      const input: ReportInput = {
        network,
        domains: await readOptional(paths.domains, DomainsArtifactSchema),
        sources: await readOptional(paths.hiringSources, HiringSourcesArtifactSchema),
        jobs: await readOptional(paths.jobs, JobsArtifactSchema),
      };

      const report = buildReport(input);

      if (options.stdout) {
        process.stdout.write(`${report}\n`);
        return;
      }

      const outPath = resolve(options.output ?? paths.report);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, `${report}\n`, "utf8");
      process.stderr.write(`Wrote ${outPath}\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
