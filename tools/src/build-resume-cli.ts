import { resolve } from "node:path";
import { Command } from "commander";
import { buildResume } from "./resume/build.js";

const program = new Command();

program
  .name("build-resume")
  .description("Compile a resume.yml into a PDF using candidate and opportunity metadata")
  .argument("<resumeYaml>", "path to resume.yml")
  .option("-o, --output <path>", "output PDF path (default: descriptive filename beside the input)")
  .action(async (resumeYaml: string, options: { output?: string }) => {
    const resumePath = resolve(resumeYaml);
    const outPath = options.output ? resolve(options.output) : undefined;

    let result;
    try {
      result = await buildResume(resumePath, outPath);
    } catch (error) {
      process.stderr.write(`Failed to read/parse ${resumePath}:\n  ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
      return;
    }

    if (!result.ok) {
      process.stderr.write(`INVALID: ${resumePath}\n`);
      for (const issue of result.issues) {
        process.stderr.write(`  ${issue.path}: ${issue.message}\n`);
      }
      process.exitCode = 1;
      return;
    }

    process.stdout.write(`Wrote ${result.outPath}\n`);
  });

program.parseAsync(process.argv);
