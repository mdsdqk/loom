import type { HttpClient } from "./client.js";
import { isSuccess } from "./client.js";

/**
 * robots.txt fetching, parsing and evaluation.
 *
 * The scan reads publicly published job listings, and it honours the sites'
 * stated crawl rules while doing so. A host whose robots.txt is missing or
 * unreadable is treated as allowing the fetch, which is the conventional
 * reading; a host that disallows a path is skipped and recorded as such.
 */

export interface RobotsRule {
  allow: boolean;
  path: string;
}

export interface RobotsPolicy {
  /** Rules for the most specific matching user-agent group. */
  rules: RobotsRule[];
  crawlDelayMs: number | null;
}

/** Our token as it would appear in a robots.txt `User-agent` line. */
const AGENT_TOKEN = "loom-network-scan";

export function parseRobots(text: string, agent = AGENT_TOKEN): RobotsPolicy {
  const groups = new Map<string, { rules: RobotsRule[]; crawlDelay: number | null }>();
  let currentAgents: string[] = [];
  let sawDirective = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      // A User-agent line after directives starts a fresh group.
      if (sawDirective) {
        currentAgents = [];
        sawDirective = false;
      }
      currentAgents.push(value.toLowerCase());
      if (!groups.has(value.toLowerCase())) {
        groups.set(value.toLowerCase(), { rules: [], crawlDelay: null });
      }
      continue;
    }

    if (currentAgents.length === 0) continue;
    sawDirective = true;

    for (const name of currentAgents) {
      const group = groups.get(name)!;
      if (field === "disallow" && value) group.rules.push({ allow: false, path: value });
      else if (field === "allow" && value) group.rules.push({ allow: true, path: value });
      else if (field === "disallow" && !value) group.rules.push({ allow: true, path: "/" });
      else if (field === "crawl-delay") {
        const seconds = Number.parseFloat(value);
        if (Number.isFinite(seconds)) group.crawlDelay = seconds * 1000;
      }
    }
  }

  const matched =
    [...groups.entries()].find(([name]) => agent.toLowerCase().includes(name) && name !== "*")?.[1] ??
    groups.get("*");

  return { rules: matched?.rules ?? [], crawlDelayMs: matched?.crawlDelay ?? null };
}

/**
 * Matches a robots path pattern (`*` wildcard, trailing `$` anchor).
 *
 * Deliberately not a regex. Compiling `*` to `.*` turns a pattern with several
 * wildcards into a catastrophic backtracker, and V8 backtracks on the stack —
 * a single unlucky robots.txt among a few thousand hosts is enough to take the
 * whole process down with a stack overflow. This scan is linear and cannot
 * blow up regardless of input.
 */
export function matchesPattern(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const segments = (anchored ? pattern.slice(0, -1) : pattern).split("*");

  if (!path.startsWith(segments[0])) return false;
  let cursor = segments[0].length;

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;

    // The final segment of an anchored pattern has to sit at the very end.
    if (anchored && i === segments.length - 1) {
      return path.length - segment.length >= cursor && path.endsWith(segment);
    }

    const found = path.indexOf(segment, cursor);
    if (found === -1) return false;
    cursor = found + segment.length;
  }

  // A pattern with no wildcard, anchored, must consume the whole path.
  return anchored && segments.length === 1 ? cursor === path.length : true;
}

export function isAllowed(policy: RobotsPolicy, pathname: string): boolean {
  let best: { allow: boolean; length: number } | null = null;

  for (const rule of policy.rules) {
    if (!matchesPattern(rule.path, pathname)) continue;
    const length = rule.path.length;
    // Longest matching pattern wins; Allow beats Disallow at equal length.
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { allow: rule.allow, length };
    }
  }

  return best ? best.allow : true;
}

/**
 * Caches one policy per origin. A host is fetched for robots.txt at most once
 * per scan, and never re-fetched for each candidate path.
 */
export class RobotsCache {
  private readonly policies = new Map<string, Promise<RobotsPolicy>>();
  private readonly applied = new Set<string>();

  constructor(private readonly client: HttpClient) {}

  private load(origin: string): Promise<RobotsPolicy> {
    let policy = this.policies.get(origin);
    if (!policy) {
      policy = this.client
        .get(`${origin}/robots.txt`)
        .then((result) => {
          if (!isSuccess(result) || result.status !== 200) return { rules: [], crawlDelayMs: null };
          if (/html/i.test(result.contentType)) return { rules: [], crawlDelayMs: null };
          return parseRobots(result.body);
        })
        .catch(() => ({ rules: [], crawlDelayMs: null }));
      this.policies.set(origin, policy);
    }
    return policy;
  }

  async allows(url: string): Promise<boolean> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    const policy = await this.load(parsed.origin);

    // Push a published Crawl-delay into the scheduler the first time this host
    // is seen, so the pacing actually reflects what the site asked for.
    if (policy.crawlDelayMs && !this.applied.has(parsed.host)) {
      this.applied.add(parsed.host);
      this.client.setHostDelay(parsed.host, policy.crawlDelayMs);
    }

    return isAllowed(policy, parsed.pathname);
  }

  /**
   * A host's requested crawl delay, if it publishes one. Parsing this and then
   * ignoring it would make the stated intent to respect robots.txt only
   * partly true.
   */
  async crawlDelayMs(url: string): Promise<number | null> {
    try {
      return (await this.load(new URL(url).origin)).crawlDelayMs;
    } catch {
      return null;
    }
  }
}
