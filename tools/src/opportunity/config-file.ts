import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { CONFIG_FILE_ENV, DEFAULT_CONFIG, DEFAULT_CONFIG_FILE, LoomConfigSchema, type LoomConfig } from "./config.js";

/** Reading the config off disk. Kept apart from `config.ts` so the schema and
 * the threshold rules stay importable in a browser bundle. */

export function resolveConfigPath(explicit?: string): string {
  return resolve(explicit ?? process.env[CONFIG_FILE_ENV] ?? DEFAULT_CONFIG_FILE);
}

/**
 * Reads the config file, falling back to defaults when it is absent. A file
 * that exists but does not parse is an error — silently ignoring a
 * misconfigured threshold would be worse than saying so.
 */
export async function loadConfig(explicitPath?: string): Promise<LoomConfig> {
  const path = resolveConfigPath(explicitPath);

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_CONFIG;
    throw error;
  }

  const parsed = LoomConfigSchema.safeParse(load(raw) ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid config at ${path} — ${detail}`);
  }
  return parsed.data;
}
