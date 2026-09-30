import { z } from "zod";
import { STATUSES, type Status } from "./schema.js";

/**
 * Portal configuration.
 *
 * Nothing here is candidate data — it is how one person wants their own search
 * measured. A search where every reply takes three weeks and one where the
 * recruiter answers same-day need different definitions of "stalled", so the
 * threshold is a setting rather than a constant.
 */

export const CONFIG_FILE_ENV = "LOOM_CONFIG_FILE";
export const DEFAULT_CONFIG_FILE = "../loom.config.yml";

export const DEFAULT_STALL_THRESHOLD_DAYS = 14;

/** Statuses where sitting still is the expected state, not a problem. */
export const DEFAULT_NEVER_STALL: readonly Status[] = ["offer", "closed"];

const PositiveDays = z.number().int().positive();

export const LoomConfigSchema = z.object({
  /** Days without movement before an opportunity counts as stalled. */
  stall_threshold_days: PositiveDays.default(DEFAULT_STALL_THRESHOLD_DAYS),
  /**
   * Per-status overrides. Keys are validated loosely so an unknown or
   * misspelled status is ignored rather than failing the whole config.
   */
  stall_threshold_days_by_status: z.record(z.string(), PositiveDays).default({}),
  /** Statuses that never stall, whatever the elapsed time. */
  never_stall: z.array(z.enum(STATUSES)).default([...DEFAULT_NEVER_STALL]),
});

export type LoomConfig = z.infer<typeof LoomConfigSchema>;

export const DEFAULT_CONFIG: LoomConfig = LoomConfigSchema.parse({});

/**
 * The stall threshold for one status, or null when that status never stalls.
 */
export function stallThresholdFor(
  status: Status,
  config: LoomConfig = DEFAULT_CONFIG
): number | null {
  if (config.never_stall.includes(status)) return null;
  const override = config.stall_threshold_days_by_status[status];
  return override ?? config.stall_threshold_days;
}
