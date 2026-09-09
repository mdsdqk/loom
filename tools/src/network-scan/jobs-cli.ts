import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import yaml from "js-yaml";
import { mapWithConcurrency } from "./concurrency.js";
import { HttpClient } from "./http/client.js";
import { RobotsCache } from "./http/robots.js";
import { dedupeJobs, fetchJobsForSource } from "./jobs.js";
import { appendDescriptions, resetDescriptions } from "./descriptions.js";
import { runPaths } from "./paths.js";
import {
  HiringSourcesArtifactSchema,
  JobsArtifactSchema,
  NetworkImportSchema,
} from "./schema.js";
import type { Job, JobsArtifact, ScanFailure } from "./schema.js";

const program = new Command();

interface JobsCliOptions {
  candidate?: string;
  input?: string;
  sources?: string;
  output?: string;
  limit?: string;
  concurrency: string;
  companyConcurrency: string;
  maxPages: string;
  batch: string;
  fresh?: boolean;
}

program
  .name("network-jobs")
  .description("Fetch open jobs from every known hiring source in the network")
  .option("-c, --candidate <dir>", "candidate workspace directory")
  .option("-i, --input <path>", "network import YAML")
  .option("-s, --sources <path>", "hiring sources YAML")
  .option("-o, --output <path>", "where to write the jobs YAML")
  .option("--limit <n>", "only fetch from the first N sources")
  .option("--concurrency <n>", "in-flight HTTP requests", "6")
  .option("--company-concurrency <n>", "sources fetched in parallel", "6")
  .option("--max-pages <n>", "page cap per source", "60")
  .option("--batch <n>", "sources per checkpoint write", "20")
  .option("--fresh", "ignore existing output and refetch everything")
  .action(async (options: JobsCliOptions) => {
    try {
      const paths = runPaths(options.candidate);
      const inputPath = resolve(options.input ?? paths.networkImport);
      const sourcesPath = resolve(options.sources ?? paths.hiringSources);
      const outPath = resolve(options.output ?? paths.jobs);
      const descriptionsPath = paths.descriptions;

      const network = NetworkImportSchema.parse(yaml.load(await readFile(inputPath, "utf8")));
      const artifact = HiringSourcesArtifactSchema.parse(
        yaml.load(await readFile(sourcesPath, "utf8"))
      );

      const nameById = new Map(network.companies.map((c) => [c.id, c.canonical_name]));
      // When two company records share a board, the one the candidate has more
      // connections at is the more useful owner of the posting.
      const connectionsById = new Map(
        network.companies.map((c) => [c.id, c.signals.connection_count])
      );
      const rank = (companyId: string): number => connectionsById.get(companyId) ?? 0;
      let sources = artifact.sources.filter((s) => s.status === "active" && s.account);
      if (options.limit) sources = sources.slice(0, Number.parseInt(options.limit, 10));

      const client = new HttpClient({ concurrency: Number.parseInt(options.concurrency, 10) });
      const robots = new RobotsCache(client);
      process.stderr.write(`Fetching jobs from ${sources.length} hiring sources\n`);

      await mkdir(dirname(outPath), { recursive: true });

      // Resume support mirrors the earlier stages: fetching thousands of
      // paginated postings is long enough that losing it all to one bad
      // response is not acceptable.
      let jobs: Job[] = [];
      let failures: ScanFailure[] = [];
      if (options.fresh) await resetDescriptions(descriptionsPath);
      if (!options.fresh) {
        try {
          const previous = JobsArtifactSchema.parse(yaml.load(await readFile(outPath, "utf8")));
          jobs = previous.jobs;
          failures = previous.failures;
        } catch {
          // No usable previous run; start clean.
        }
      }

      // A retryable failure — a transient 5xx, a timeout — should be attempted
      // again on resume; only permanent ones are settled. Treating every
      // recorded failure as done meant a blip permanently lost that company,
      // and counting them as successes overstated the run.
      const permanentFailures = failures.filter((failure) => !failure.retryable);
      failures = permanentFailures;

      const settled = new Set<string>([
        ...jobs.map((job) => job.company_id),
        ...permanentFailures.map((failure) => failure.company_id ?? ""),
      ]);
      const remaining = sources.filter((source) => !settled.has(source.company_id));
      if (settled.size > 0) {
        process.stderr.write(`Resuming: ${settled.size} settled, ${remaining.length} to go\n`);
      }

      let done = sources.length - remaining.length;
      let succeeded = Math.max(0, done - permanentFailures.length);
      let found = jobs.length;
      let truncated = 0;
      const batchSize = Math.max(1, Number.parseInt(options.batch, 10));
      const maxPages = Number.parseInt(options.maxPages, 10);

      const write = async (): Promise<JobsArtifact> => {
        const deduped = dedupeJobs(jobs, rank);
        const byProvider: Record<string, number> = {};
        for (const job of deduped.jobs) {
          byProvider[job.source.provider] = (byProvider[job.source.provider] ?? 0) + 1;
        }

        const current = JobsArtifactSchema.parse({
          source: network.source,
          fetched_at: new Date().toISOString(),
          counts: {
            sources_attempted: sources.length,
            sources_succeeded: succeeded,
            sources_truncated: truncated,
            jobs_before_dedupe: jobs.length,
            jobs: deduped.jobs.length,
            duplicates_removed: deduped.removed,
            matching_preferences: deduped.jobs.filter((job) => job.matches_preferences).length,
            by_provider: byProvider,
          },
          http: {
            requests: client.stats.requests,
            cache_hits: client.stats.cacheHits,
            failures: client.stats.failures,
          },
          failures,
          jobs: deduped.jobs,
        });
        await writeFile(outPath, yaml.dump(current, { lineWidth: 100 }), "utf8");
        return current;
      };

      for (let start = 0; start < remaining.length; start += batchSize) {
        const results = await mapWithConcurrency(
          remaining.slice(start, start + batchSize),
          Number.parseInt(options.companyConcurrency, 10),
          async (source) => ({
            source,
            result: await fetchJobsForSource(source, {
              client,
              companyName: nameById.get(source.company_id) ?? source.company_id,
              preferences: network.preferences,
              maxPages,
              robots,
            }),
          }),
          ({ source, result }) => {
            done += 1;
            found += result.jobs.length;
            if (result.truncated) truncated += 1;
            // A single broken board must never abort the scan.
            if (result.error) {
              failures.push({
                company_id: source.company_id,
                stage: "job_fetch",
                error: result.error,
                retryable: !/no adapter|no account/.test(result.error),
              });
            } else {
              succeeded += 1;
            }
            if (done % 10 === 0 || done === sources.length) {
              process.stderr.write(
                `  ${done}/${sources.length} sources — ${found} jobs so far\n`
              );
            }
          }
        );

        for (const { result } of results) jobs.push(...result.jobs);
        // Descriptions stream to their own file as they arrive, so the index
        // stays small and a crash does not lose the text already fetched.
        await appendDescriptions(
          descriptionsPath,
          results.flatMap(({ result }) => result.descriptions)
        );
        await write();
      }

      const final = await write();
      process.stderr.write(`Wrote ${outPath}\n`);

      const { counts } = final;
      process.stderr.write(
        [
          `Sources attempted:      ${counts.sources_attempted}`,
          `  succeeded:            ${counts.sources_succeeded}`,
          `  failed:               ${final.failures.length}`,
          `  truncated at cap:     ${counts.sources_truncated}`,
          `Jobs:                   ${counts.jobs}`,
          `  duplicates removed:   ${counts.duplicates_removed}`,
          `  matching preferences: ${counts.matching_preferences}`,
          ...Object.entries(counts.by_provider)
            .sort((a, b) => b[1] - a[1])
            .map(([provider, n]) => `    ${provider.padEnd(18)}${n}`),
          "",
        ].join("\n")
      );
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
