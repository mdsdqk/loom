import { resolve } from "node:path";
import { Command } from "commander";
import { createOpportunity } from "./resume/opportunity.js";

const program = new Command();

interface CreateOpportunityCliOptions {
  company?: string;
  role?: string;
  jobId?: string;
  postedDate?: string;
  opportunitiesRoot: string;
}

program
  .name("create-opportunity")
  .description("Create an opportunity workspace from a master resume and a job description")
  .argument("<masterResume>", "path to the master resume YAML file")
  .argument("<jd>", "path to the job description (markdown)")
  .option("--company <company>", "explicit company name override")
  .option("--role <role>", "explicit job title override")
  .option("--job-id <id>", "explicit job/requisition ID override (takes priority over posting date for slug disambiguation)")
  .option("--posted-date <date>", "explicit posting date override, e.g. 2026-03-04 (used when no job ID is available)")
  .option("--opportunities-root <path>", "root directory for opportunities", "../opportunities")
  .action(async (masterResume: string, jd: string, options: CreateOpportunityCliOptions) => {
    try {
      const result = await createOpportunity({
        masterResumePath: resolve(masterResume),
        jdPath: resolve(jd),
        opportunitiesRoot: resolve(options.opportunitiesRoot),
        company: options.company,
        role: options.role,
        jobId: options.jobId,
        postedDate: options.postedDate,
      });
      process.stdout.write(
        `Created opportunity "${result.slug}" (${result.company} · ${result.title})\n  ${result.artifactsDir}\n`
      );
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
