import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import yaml from "js-yaml";
import { buildNetworkImport, summarize } from "./build.js";
import { runPaths } from "../paths.js";

const program = new Command();

interface NetworkImportCliOptions {
  candidate?: string;
  output?: string;
  stdout?: boolean;
}

program
  .name("network-import")
  .description("Read a LinkedIn data export into the network scan's company list")
  .argument("<exportDir>", "path to the unzipped LinkedIn data export directory")
  .option("-c, --candidate <dir>", "candidate workspace directory")
  .option("-o, --output <path>", "where to write the import YAML")
  .option("--stdout", "print YAML to stdout instead of writing a file")
  .action(async (exportDir: string, options: NetworkImportCliOptions) => {
    try {
      const result = await buildNetworkImport(resolve(exportDir));
      const text = yaml.dump(result, { lineWidth: 100 });

      if (options.stdout) {
        process.stdout.write(text);
      } else {
        const outPath = resolve(options.output ?? runPaths(options.candidate).networkImport);
        await mkdir(dirname(outPath), { recursive: true });
        await writeFile(outPath, text, "utf8");
        process.stderr.write(`Wrote ${outPath}\n`);
      }

      process.stderr.write(`${summarize(result)}\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
