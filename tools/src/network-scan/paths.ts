import { resolve } from "node:path";

/**
 * Where a run's files live.
 *
 * Loom is built for any candidate, not for whoever happens to be developing it,
 * so nothing here hardcodes a person or a workspace. The candidate directory is
 * chosen per run — by flag, by environment, or by a sensible default — and
 * every artifact a run produces hangs off it.
 *
 * The registry is deliberately *not* under the candidate directory: it holds
 * public company knowledge (which domain a company uses, which ATS it runs) and
 * no personal data, so it is shared across candidates and checked into the
 * repository.
 */

/** Environment override, useful for self-hosted deployments and for tests. */
export const CANDIDATE_DIR_ENV = "LOOM_CANDIDATE_DIR";

export const DEFAULT_CANDIDATE_DIR = "../candidate";

export interface RunPaths {
  candidateDir: string;
  /** Directory holding every network-scan artifact for this candidate. */
  scanDir: string;
  networkImport: string;
  domains: string;
  hiringSources: string;
  jobs: string;
  /** Full JD text, kept out of the job index. */
  descriptions: string;
  report: string;
}

/**
 * Resolves the candidate workspace, preferring an explicit flag over the
 * environment over the default.
 */
export function resolveCandidateDir(explicit?: string): string {
  return resolve(explicit ?? process.env[CANDIDATE_DIR_ENV] ?? DEFAULT_CANDIDATE_DIR);
}

export function runPaths(explicitCandidateDir?: string): RunPaths {
  const candidateDir = resolveCandidateDir(explicitCandidateDir);
  const scanDir = resolve(candidateDir, "network-scan");

  return {
    candidateDir,
    scanDir,
    networkImport: resolve(scanDir, "network.yml"),
    domains: resolve(scanDir, "domains.yml"),
    hiringSources: resolve(scanDir, "hiring-sources.yml"),
    jobs: resolve(scanDir, "jobs.yml"),
    descriptions: resolve(scanDir, "descriptions.jsonl"),
    report: resolve(scanDir, "report.md"),
  };
}

/** Shared, non-personal knowledge, versioned with the code rather than the candidate. */
export const REGISTRY_DIR = "src/network-scan/registry";

export function registryPaths(explicit?: string): { domains: string; hiringSources: string } {
  const dir = resolve(explicit ?? REGISTRY_DIR);
  return {
    domains: resolve(dir, "company-domains.yml"),
    hiringSources: resolve(dir, "hiring-sources.yml"),
  };
}
