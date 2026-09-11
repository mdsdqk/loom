import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import yaml from "js-yaml";
import { mapWithConcurrency } from "./concurrency.js";
import { discoverHiringSource } from "./discover.js";
import { BrowserProbe } from "./browser-probe.js";
import { HttpClient } from "./http/client.js";
import { RobotsCache } from "./http/robots.js";
import { runPaths, registryPaths } from "./paths.js";
import { loadHiringSourceRegistry, saveHiringSourceRegistry } from "./registry.js";
import {
  DomainsArtifactSchema,
  HiringSourcesArtifactSchema,
  NetworkImportSchema,
} from "./schema.js";
import type { HiringSource, HiringSourcesArtifact } from "./schema.js";

const program = new Command();

interface DiscoverCliOptions {
  candidate?: string;
  input?: string;
  domains?: string;
  output?: string;
  registry?: string;
  limit?: string;
  minConnections: string;
  concurrency: string;
  companyConcurrency: string;
  batch: string;
  timeout: string;
  browser?: boolean;
  fresh?: boolean;
  registryWrite: boolean;
}

function progress(done: number, total: number, withProvider: number): void {
  if (done % 25 !== 0 && done !== total) return;
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  process.stderr.write(
    `  ${done}/${total} companies — ${withProvider} with a provider [rss ${rssMb}MB]\n`
  );
}

function buildCounts(sources: HiringSource[]): HiringSourcesArtifact["counts"] {
  const byProvider: Record<string, number> = {};
  for (const source of sources) {
    if (source.status !== "active") continue;
    byProvider[source.provider] = (byProvider[source.provider] ?? 0) + 1;
  }

  return {
    companies: sources.length,
    careers_page_found: sources.filter((s) => Boolean(s.careers_url)).length,
    provider_detected: sources.filter((s) => s.status === "active").length,
    unsupported_provider: sources.filter((s) => s.status === "unsupported").length,
    no_provider: sources.filter((s) => s.status === "no_provider").length,
    no_careers_page: sources.filter((s) => s.status === "no_careers_page").length,
    by_provider: byProvider,
  };
}

async function loadExisting(outPath: string): Promise<HiringSource[]> {
  try {
    return HiringSourcesArtifactSchema.parse(yaml.load(await readFile(outPath, "utf8"))).sources;
  } catch {
    return [];
  }
}

program
  .name("network-discover")
  .description("Find each company's careers page and identify its applicant-tracking system")
  .option("-c, --candidate <dir>", "candidate workspace directory")
  .option("-i, --input <path>", "network import YAML")
  .option("-d, --domains <path>", "resolved domains YAML")
  .option("-o, --output <path>", "where to write the hiring sources YAML")
  .option("-r, --registry <dir>", "shared registry directory")
  .option("--limit <n>", "only process the first N companies")
  .option("--min-connections <n>", "skip companies with fewer than N connections", "1")
  .option("--concurrency <n>", "in-flight HTTP requests", "8")
  .option("--company-concurrency <n>", "companies processed in parallel", "8")
  .option("--batch <n>", "companies per checkpoint write", "25")
  .option("--timeout <ms>", "per-request timeout", "8000")
  .option("--browser", "render careers pages that expose no provider in static HTML")
  .option("--fresh", "ignore existing output and rediscover every company")
  .option("--no-registry-write", "do not fold discovered sources back into the registry")
  .action(async (options: DiscoverCliOptions) => {
    let browser: BrowserProbe | undefined;
    try {
      const paths = runPaths(options.candidate);
      const registryFiles = registryPaths(options.registry);
      const inputPath = resolve(options.input ?? paths.networkImport);
      const domainsPath = resolve(options.domains ?? paths.domains);
      const outPath = resolve(options.output ?? paths.hiringSources);

      const network = NetworkImportSchema.parse(yaml.load(await readFile(inputPath, "utf8")));
      const domainsArtifact = DomainsArtifactSchema.parse(
        yaml.load(await readFile(domainsPath, "utf8"))
      );

      const domainById = new Map(
        domainsArtifact.domains
          .filter((entry) => entry.status === "verified" && entry.domain)
          .map((entry) => [entry.company_id, entry.domain!])
      );

      const minConnections = Number.parseInt(options.minConnections, 10);
      let companies = network.companies.filter(
        (company) =>
          company.signals.connection_count >= minConnections && domainById.has(company.id)
      );
      if (options.limit) companies = companies.slice(0, Number.parseInt(options.limit, 10));

      const registry = await loadHiringSourceRegistry(registryFiles.hiringSources);
      // Discovery probes speculative URLs, where a timeout means "not here"
      // rather than "try again": retrying them triples the cost of every dead
      // guess, and all of a company's probes are serialized to one host.
      const client = new HttpClient({
        concurrency: Number.parseInt(options.concurrency, 10),
        timeoutMs: Number.parseInt(options.timeout, 10),
        maxAttempts: 2,
      });
      const robots = new RobotsCache(client);
      browser = options.browser ? new BrowserProbe() : undefined;

      process.stderr.write(
        `Discovering hiring sources for ${companies.length} companies with a verified domain` +
          ` (${registry.size} in registry)\n`
      );

      await mkdir(dirname(outPath), { recursive: true });
      const sources: HiringSource[] = options.fresh ? [] : await loadExisting(outPath);
      const done0 = new Set(sources.map((s) => s.company_id));
      const remaining = companies.filter((company) => !done0.has(company.id));
      if (done0.size > 0) {
        process.stderr.write(`Resuming: ${done0.size} done, ${remaining.length} to go\n`);
      }

      let withProvider = sources.filter((s) => s.status === "active").length;
      let done = done0.size;
      const batchSize = Math.max(1, Number.parseInt(options.batch, 10));

      const write = async (): Promise<HiringSourcesArtifact> => {
        const artifact = HiringSourcesArtifactSchema.parse({
          source: network.source,
          discovered_at: new Date().toISOString(),
          counts: buildCounts(sources),
          http: {
            requests: client.stats.requests,
            cache_hits: client.stats.cacheHits,
            failures: client.stats.failures,
          },
          sources,
        });
        await writeFile(outPath, yaml.dump(artifact, { lineWidth: 100 }), "utf8");
        return artifact;
      };

      for (let start = 0; start < remaining.length; start += batchSize) {
        const batch = await mapWithConcurrency(
          remaining.slice(start, start + batchSize),
          Number.parseInt(options.companyConcurrency, 10),
          (company) =>
            discoverHiringSource(
              {
                companyId: company.id,
                companyName: company.canonical_name,
                domain: domainById.get(company.id)!,
              },
              { client, robots, registry, browser }
            ),
          (source) => {
            if (source.status === "active") withProvider += 1;
            progress(++done, companies.length, withProvider);
          }
        );
        sources.push(...batch);
        await write();
      }

      const artifact = await write();
      process.stderr.write(`Wrote ${outPath}\n`);

      if (options.registryWrite) {
        const added = await saveHiringSourceRegistry(
          registryFiles.hiringSources,
          registry,
          sources.filter((s) => s.status === "active" || s.status === "unsupported")
        );
        process.stderr.write(`Registry: +${added} sources (${registryFiles.hiringSources})\n`);
      }

      const { counts } = artifact;
      process.stderr.write(
        [
          `Companies:              ${counts.companies}`,
          `  careers page found:   ${counts.careers_page_found}`,
          `  provider detected:    ${counts.provider_detected}`,
          ...Object.entries(counts.by_provider)
            .sort((a, b) => b[1] - a[1])
            .map(([provider, n]) => `    ${provider.padEnd(18)}${n}`),
          `  known but no adapter: ${counts.unsupported_provider}`,
          `  no provider found:    ${counts.no_provider}`,
          `  no careers page:      ${counts.no_careers_page}`,
          "",
        ].join("\n")
      );
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    } finally {
      // Chromium outlives the run otherwise — including when the run throws.
      await browser?.close();
    }
  });

program.parseAsync(process.argv);
