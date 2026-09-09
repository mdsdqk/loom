import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import yaml from "js-yaml";
import { mapWithConcurrency } from "./concurrency.js";
import { appendDescriptions, loadDescriptions } from "./descriptions.js";
import { HttpClient } from "./http/client.js";
import { calibrate, formatCalibration, parseSavedJobs } from "./matching/calibration.js";
import { fetchDescription, needsDescription } from "./matching/enrich.js";
import { formatFunnel, runMatching } from "./matching/pipeline.js";
import { structuralVerdict } from "./matching/structural.js";
import type { Level } from "./matching/structural.js";
import { familyVerdict } from "./matching/taxonomy.js";
import type { Family } from "./matching/taxonomy.js";
import { loadExport } from "./import/export-reader.js";
import { runPaths } from "./paths.js";
import { buildReferrerIndex } from "./referrals.js";
import { JobsArtifactSchema, NetworkImportSchema } from "./schema.js";
import type { Job } from "./schema.js";

const program = new Command();

interface MatchCliOptions {
  candidate?: string;
  export?: string;
  output?: string;
  families: string;
  minLevel?: string;
  maxLevel?: string;
  maxAge?: string;
  minScore?: string;
  referralWeight: string;
  top: string;
  enrich: boolean;
  enrichLimit: string;
  concurrency: string;
}

program
  .name("network-match")
  .description("Filter and rank scanned jobs against the candidate, cheapest checks first")
  .option("-c, --candidate <dir>", "candidate workspace directory")
  .option("-e, --export <dir>", "LinkedIn export directory, for calibration against saved jobs")
  .option("-o, --output <path>", "where to write the ranked matches")
  .option("--families <list>", "comma-separated disciplines to keep", "engineering")
  .option("--min-level <level>", "lowest acceptable seniority (intern|junior|mid|senior|lead|executive)")
  .option("--max-level <level>", "highest acceptable seniority")
  .option("--max-age <days>", "drop postings older than this, where dated")
  .option("--min-score <n>", "drop jobs scoring below this (0-1) once they have a description")
  .option("--referral-weight <n>", "how much who-you-know counts in the ranking (0-1)", "0.4")
  .option("--top <n>", "how many matches to write", "200")
  .option("--no-enrich", "skip fetching descriptions the list endpoints omitted")
  .option("--enrich-limit <n>", "cap on descriptions fetched in one run", "400")
  .option("--concurrency <n>", "in-flight HTTP requests", "6")
  .action(async (options: MatchCliOptions) => {
    try {
      const paths = runPaths(options.candidate);
      const network = NetworkImportSchema.parse(
        yaml.load(await readFile(paths.networkImport, "utf8"))
      );
      const artifact = JobsArtifactSchema.parse(yaml.load(await readFile(paths.jobs, "utf8")));
      const descriptions = await loadDescriptions(paths.descriptions);

      const matchOptions = {
        wantedFamilies: options.families.split(",").map((f) => f.trim()) as Family[],
        minLevel: options.minLevel as Level | undefined,
        maxLevel: options.maxLevel as Level | undefined,
        maxAgeDays: options.maxAge ? Number.parseInt(options.maxAge, 10) : undefined,
        minScore: options.minScore ? Number.parseFloat(options.minScore) : undefined,
        referralWeight: Number.parseFloat(options.referralWeight),
      };

      process.stderr.write(
        `Matching ${artifact.jobs.length} jobs against ${network.skills.listed.length} listed skills\n\n`
      );

      // First pass: the cheap tiers, which decide what is worth enriching.
      let result = runMatching(artifact.jobs, network, descriptions, matchOptions);

      // Tier 2.5 — fetch the descriptions the cheap tiers proved worth paying for.
      if (options.enrich && result.needsDescription.length > 0) {
        const limit = Number.parseInt(options.enrichLimit, 10);
        const targets = result.needsDescription
          .filter((job) => needsDescription(job, descriptions))
          .slice(0, limit);

        if (targets.length > 0) {
          process.stderr.write(
            `Fetching ${targets.length} descriptions the list endpoints omitted` +
              ` (of ${result.needsDescription.length} missing)\n`
          );

          const client = new HttpClient({
            concurrency: Number.parseInt(options.concurrency, 10),
            maxAttempts: 2,
          });
          let done = 0;
          const fetched = await mapWithConcurrency(
            targets,
            Number.parseInt(options.concurrency, 10),
            (job: Job) => fetchDescription(job, client),
            () => {
              if (++done % 50 === 0) process.stderr.write(`  ${done}/${targets.length}\n`);
            }
          );

          const gained = fetched.filter((entry) => entry.text);
          for (const entry of gained) descriptions.set(entry.id, entry.text!);
          await appendDescriptions(
            paths.descriptions,
            gained.map((entry) => ({ id: entry.id, text: entry.text! }))
          );
          process.stderr.write(`  got ${gained.length}, failed ${fetched.length - gained.length}\n\n`);

          // Re-run with the new text so scoring sees it.
          result = runMatching(artifact.jobs, network, descriptions, matchOptions);
        }
      }

      process.stderr.write(`Funnel\n${formatFunnel(result.funnel)}\n\n`);

      const referrers = buildReferrerIndex(network.companies);
      const top = result.ranked.slice(0, Number.parseInt(options.top, 10));

      const outPath = resolve(options.output ?? resolve(paths.scanDir, "matches.yml"));
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(
        outPath,
        yaml.dump(
          {
            source: network.source,
            matched_at: new Date().toISOString(),
            options: matchOptions,
            counts: {
              considered: artifact.jobs.length,
              ranked: result.ranked.length,
              written: top.length,
              awaiting_description: result.needsDescription.length,
              awaiting_discipline_review: result.needsDisciplineReview.length,
            },
            funnel: result.funnel,
            matches: top.map((entry) => ({
              rank: entry.rank,
              match_score: entry.matchScore,
              relative_match: entry.relativeMatch,
              referral_score: entry.referralScore,
              discipline_confirmed: entry.disciplineConfirmed,
              company: entry.job.company_name,
              title: entry.job.title,
              locations: entry.job.locations,
              url: entry.job.job_url,
              matched_terms: entry.matchedTerms.slice(0, 15),
              ask: (referrers.get(entry.job.company_id) ?? []).map((person) => ({
                name: person.name,
                position: person.position,
                linkedin_url: person.linkedinUrl,
                why: person.reasons,
              })),
            })),
          },
          { lineWidth: 100 }
        ),
        "utf8"
      );
      process.stderr.write(`Wrote ${outPath}\n`);

      // Measure the funnel against jobs the candidate saved themselves, rather
      // than trusting that it looks reasonable.
      const exportDir = options.export;
      if (exportDir) {
        const { rows } = await loadExport(resolve(exportDir));
        const saved = parseSavedJobs(rows.savedJobs);
        const decide = (job: Job): string | null => {
          const structural = structuralVerdict(job, {
            preferences: network.preferences,
            minLevel: matchOptions.minLevel,
            maxLevel: matchOptions.maxLevel,
            maxAgeDays: matchOptions.maxAgeDays,
          });
          if (!structural.keep) return `structural:${structural.stage}`;
          const family = familyVerdict(job.title, { wanted: matchOptions.wantedFamilies });
          return family.keep ? null : `discipline:${family.family}`;
        };
        process.stderr.write(`\n${formatCalibration(calibrate(saved, artifact.jobs, decide))}\n`);
      }

      process.stderr.write(
        [
          "",
          `Ranked:                 ${result.ranked.length}`,
          `  written:              ${top.length}`,
          `  awaiting description: ${result.needsDescription.length}`,
          `  need a model to place:${result.needsDisciplineReview.length}`,
          "",
        ].join("\n")
      );
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
