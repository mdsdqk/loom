import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import yaml from "js-yaml";
import { normalizationKey } from "./import/connections.js";
import { HiringSourceSchema } from "./schema.js";
import type { HiringSource } from "./schema.js";

/**
 * The cross-run cache of what the scan has learned about companies.
 *
 * Unlike a run's output, this holds no personal data — it maps public company
 * names to public corporate domains and hiring surfaces. It is the asset that
 * makes a second scan cheap, so it is checked into the repository and is
 * meant to be readable and editable by hand.
 */

export interface DomainRegistryEntry {
  company: string;
  domain: string;
  note?: string;
}

/**
 * Only well-identified domains belong in the shared registry.
 *
 * A partial-name match ("Tata Consultancy Services" against a page that only
 * says "Tata") or a two-letter company name is a guess we accepted reluctantly.
 * Writing it here would promote it to registry confidence on every later run
 * and stop it ever being re-examined — the cache would slowly poison itself.
 */
export function isRegistryWorthy(entry: {
  confidence: number;
  partial_name?: boolean;
  weak_name?: boolean;
}): boolean {
  return entry.confidence >= 0.85 && !entry.partial_name && !entry.weak_name;
}

/** Keyed by normalized company name, so registry lookups survive name variants. */
export async function loadDomainRegistry(path: string): Promise<Map<string, string>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return new Map();
  }

  const parsed = yaml.load(text);
  const entries = Array.isArray((parsed as { companies?: unknown })?.companies)
    ? ((parsed as { companies: DomainRegistryEntry[] }).companies ?? [])
    : [];

  const registry = new Map<string, string>();
  for (const entry of entries) {
    if (!entry?.company || !entry?.domain) continue;
    registry.set(normalizationKey(entry.company), entry.domain.trim().toLowerCase());
  }
  return registry;
}

/**
 * Folds newly verified domains back into the registry file, so the next run
 * resolves them without re-fetching. Existing entries are never overwritten —
 * a hand-written mapping outranks anything the scan guessed.
 */
export async function saveDomainRegistry(
  path: string,
  existing: Map<string, string>,
  discovered: { company: string; domain: string }[]
): Promise<number> {
  // Re-read rather than trusting the snapshot taken at process start: a scan
  // runs for a long time, and a hand edit made meanwhile must not be clobbered
  // by a wholesale rewrite.
  const current = await loadDomainRegistry(path);
  const merged = new Map([...existing, ...current]);
  let added = 0;

  for (const { company, domain } of discovered) {
    const key = normalizationKey(company);
    if (!key || merged.has(key)) continue;
    merged.set(key, domain);
    added += 1;
  }

  const companies = [...merged.entries()]
    .map(([key, domain]) => ({ company: key, domain }))
    .sort((a, b) => (a.company < b.company ? -1 : a.company > b.company ? 1 : 0));

  const header =
    "# Verified company -> corporate domain mappings, reused across scans.\n" +
    "# Company keys are normalized names (lowercase, legal suffixes stripped).\n" +
    "# Hand-edited entries take priority over anything the scanner discovers.\n";

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${header}${yaml.dump({ companies }, { lineWidth: 100 })}`, "utf8");

  return added;
}

/**
 * The hiring-source half of the registry: company → careers URL, provider and
 * board token. Like the domain registry it holds only public knowledge about
 * employers, so it is shared across candidates and checked in.
 */
export async function loadHiringSourceRegistry(path: string): Promise<Map<string, HiringSource>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return new Map();
  }

  const parsed = yaml.load(text);
  const entries = Array.isArray((parsed as { sources?: unknown })?.sources)
    ? ((parsed as { sources: HiringSource[] }).sources ?? [])
    : [];

  const registry = new Map<string, HiringSource>();
  for (const entry of entries) {
    const valid = HiringSourceSchema.safeParse(entry);
    if (valid.success) registry.set(valid.data.company_id, valid.data);
  }
  return registry;
}

/** Adds newly discovered sources without ever overwriting an existing entry. */
export async function saveHiringSourceRegistry(
  path: string,
  existing: Map<string, HiringSource>,
  discovered: HiringSource[]
): Promise<number> {
  const current = await loadHiringSourceRegistry(path);
  const merged = new Map([...existing, ...current]);
  let added = 0;

  for (const source of discovered) {
    if (!source.company_id || merged.has(source.company_id)) continue;
    // `discovery_method` describes how this run found it, not a durable fact
    // about the company, so it is not carried into the shared registry.
    const durable = { ...source };
    delete durable.discovery_method;
    merged.set(source.company_id, durable);
    added += 1;
  }

  const sources = [...merged.values()].sort((a, b) =>
    a.company_id < b.company_id ? -1 : a.company_id > b.company_id ? 1 : 0
  );

  const header =
    "# Known company -> careers page and applicant-tracking system, reused across scans.\n" +
    "# Public employer information only; no candidate data. Hand edits win over discovery.\n";

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${header}${yaml.dump({ sources }, { lineWidth: 100 })}`, "utf8");

  return added;
}
