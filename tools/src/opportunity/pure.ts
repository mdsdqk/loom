/**
 * Everything about an opportunity that does not touch the filesystem.
 *
 * The web client imports this subpath so it computes status, rounds, idle days
 * and staleness with exactly the same code the CLI uses, without pulling
 * `node:fs` into a browser bundle.
 */

export * from "./schema.js";
export * from "./config.js";
export * from "./derive.js";
