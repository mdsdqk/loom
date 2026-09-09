import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import yaml from "js-yaml";
import { HttpClient } from "./http/client.js";
import { RobotsCache } from "./http/robots.js";
import { resolveCompanyDomain, summarizeAttempts } from "./domains.js";
import { mapWithConcurrency } from "./concurrency.js";
import { isRegistryWorthy, loadDomainRegistry, saveDomainRegistry } from "./registry.js";
import { runPaths, registryPaths } from "./paths.js";
import { DomainsArtifactSchema, NetworkImportSchema } from "./schema.js";
import type { CompanyDomain, DomainsArtifact } from "./schema.js";

const program = new Command();

interface DomainsCliOptions {
  candidate?: string;
  input?: string;
  output?: string;
  registry?: string;
  limit?: string;
  concurrency: string;
  companyConcurrency: string;
  batch: string;
  fresh?: boolean;
  minConnections: string;
  /** Commander maps `--no-registry-write` onto this, defaulting to true. */
  registryWrite: boolean;
}

/**
 * Progress on stderr, so a long scan is legible while it runs.
 *
 * Resident memory and live handle counts ride along because this process talks
 * to thousands of unrelated hosts: when a long run dies, the trajectory of
 * those two numbers is the difference between diagnosing it and guessing.
 */
function progress(done: number, total: number, verified: number): void {
  if (done % 25 !== 0 && done !== total) return;

  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const handles = process.getActiveResourcesInfo();
  const sockets = handles.filter((handle) => handle === "TCPSocketWrap").length;

  process.stderr.write(
    `  ${done}/${total} companies — ${verified} verified` +
      ` [rss ${rssMb}MB, handles ${handles.length}, sockets ${sockets}]\n`
  );
}

/** Reads a previous run's output so an interrupted scan can pick up where it stopped. */
async function loadExistingDomains(outPath: string): Promise<CompanyDomain[]> {
  try {
    return DomainsArtifactSchema.parse(yaml.load(await readFile(outPath, "utf8"))).domains;
  } catch {
    return [];
  }
}

function buildCounts(domains: CompanyDomain[]): DomainsArtifact["counts"] {
  const unresolvedReasons: Record<string, number> = {};
  for (const entry of domains) {
    if (entry.status !== "unresolved") continue;
    const reason = summarizeAttempts(entry.attempts);
    unresolvedReasons[reason] = (unresolvedReasons[reason] ?? 0) + 1;
  }

  return {
    companies: domains.length,
    verified: domains.filter((d) => d.status === "verified").length,
    from_registry: domains.filter((d) => d.method === "registry").length,
    unresolved: domains.filter((d) => d.status === "unresolved").length,
    weak_name: domains.filter((d) => d.weak_name).length,
    partial_name: domains.filter((d) => d.partial_name).length,
    low_confidence: domains.filter((d) => d.status === "verified" && d.confidence < 0.85).length,
    unresolved_reasons: unresolvedReasons,
  };
}

program
  .name("network-domains")
  .description("Resolve each network company to a verified corporate domain")
  .option("-c, --candidate <dir>", "candidate workspace directory")
  .option("-i, --input <path>", "network import YAML")
  .option("-o, --output <path>", "where to write the domains YAML")
  .option("-r, --registry <dir>", "shared registry directory")
  .option("--limit <n>", "only resolve the first N companies (by connection count)")
  .option("--min-connections <n>", "skip companies with fewer than N connections", "1")
  .option("--concurrency <n>", "in-flight HTTP requests", "8")
  .option("--company-concurrency <n>", "companies resolved in parallel", "12")
  .option("--batch <n>", "companies per checkpoint write", "50")
  .option("--fresh", "ignore existing output and resolve every company again")
  .option("--no-registry-write", "do not fold newly verified domains back into the registry")
  .action(async (options: DomainsCliOptions) => {
    try {
      const paths = runPaths(options.candidate);
      const inputPath = resolve(options.input ?? paths.networkImport);
      const parsed = NetworkImportSchema.parse(yaml.load(await readFile(inputPath, "utf8")));

      const minConnections = Number.parseInt(options.minConnections, 10);
      let companies = parsed.companies.filter(
        (company) => company.signals.connection_count >= minConnections
      );
      if (options.limit) companies = companies.slice(0, Number.parseInt(options.limit, 10));

      const registryPath = registryPaths(options.registry).domains;
      const registry = await loadDomainRegistry(registryPath);

      const client = new HttpClient({ concurrency: Number.parseInt(options.concurrency, 10) });
      const robots = new RobotsCache(client);

      process.stderr.write(
        `Resolving ${companies.length} companies (${registry.size} in registry)\n`
      );

      const outPath = resolve(options.output ?? paths.domains);
      await mkdir(dirname(outPath), { recursive: true });

      // Resolving a whole network is a long job against hundreds of unrelated
      // servers, and any of them can misbehave. Results are checkpointed after
      // each batch and finished companies are skipped next time, so an
      // interruption costs one batch rather than the entire scan.
      const domains: CompanyDomain[] = options.fresh ? [] : await loadExistingDomains(outPath);
      const alreadyDone = new Set(domains.map((entry) => entry.company_id));
      const remaining = companies.filter((company) => !alreadyDone.has(company.id));

      if (alreadyDone.size > 0) {
        process.stderr.write(
          `Resuming: ${alreadyDone.size} already resolved, ${remaining.length} to go\n`
        );
      }

      // Bound the companies in flight, not just the HTTP requests: each company
      // also holds DNS lookups and buffered bodies.
      let verified = domains.filter((entry) => entry.status === "verified").length;
      let done = alreadyDone.size;
      const batchSize = Math.max(1, Number.parseInt(options.batch, 10));

      const writeArtifact = async (): Promise<DomainsArtifact> => {
        const current: DomainsArtifact = DomainsArtifactSchema.parse({
          source: parsed.source,
          resolved_at: new Date().toISOString(),
          counts: buildCounts(domains),
          http: {
            requests: client.stats.requests,
            cache_hits: client.stats.cacheHits,
            failures: client.stats.failures,
          },
          domains,
        });
        await writeFile(outPath, yaml.dump(current, { lineWidth: 100 }), "utf8");
        return current;
      };

      for (let start = 0; start < remaining.length; start += batchSize) {
        const resolved = await mapWithConcurrency(
          remaining.slice(start, start + batchSize),
          Number.parseInt(options.companyConcurrency, 10),
          (company) => resolveCompanyDomain(company, { client, robots, registry }),
          (entry) => {
            if (entry.status === "verified") verified += 1;
            progress(++done, companies.length, verified);
          }
        );
        domains.push(...resolved);
        await writeArtifact();
      }

      const artifact = await writeArtifact();
      process.stderr.write(`Wrote ${outPath}\n`);

      if (options.registryWrite) {
        const byId = new Map(parsed.companies.map((company) => [company.id, company]));
        const added = await saveDomainRegistry(
          registryPath,
          registry,
          domains
            .filter(
              (entry) =>
                entry.status === "verified" &&
                entry.method === "guess_verified" &&
                isRegistryWorthy(entry)
            )
            .map((entry) => ({
              company: byId.get(entry.company_id)?.canonical_name ?? entry.company_id,
              domain: entry.domain!,
            }))
        );
        process.stderr.write(`Registry: +${added} entries (${registryPath})\n`);
      }

      const { counts, http } = artifact;
      process.stderr.write(
        [
          `Companies:              ${counts.companies}`,
          `  verified domain:      ${counts.verified}`,
          `    from registry:      ${counts.from_registry}`,
          `    weak short name:    ${counts.weak_name}`,
          `    partial name only:  ${counts.partial_name}`,
          `    low confidence:     ${counts.low_confidence}`,
          `  unresolved:           ${counts.unresolved}`,
          ...Object.entries(counts.unresolved_reasons)
            .sort((a, b) => b[1] - a[1])
            .map(([reason, n]) => `    ${reason.padEnd(18)}${n}`),
          `HTTP requests:          ${http.requests} (${http.cache_hits} cached, ${http.failures} failed)`,
          "",
        ].join("\n")
      );
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
