import { amazon } from "./amazon.js";
import { ashby } from "./ashby.js";
import { greenhouse } from "./greenhouse.js";
import { lever } from "./lever.js";
import { recruitee } from "./recruitee.js";
import { smartrecruiters } from "./smartrecruiters.js";
import { workable } from "./workable.js";
import { workday } from "./workday.js";
import type { ProviderAdapter, ProviderId } from "./types.js";

/**
 * The provider registry.
 *
 * Adding an ATS is one new file plus one line here — discovery, fetching,
 * normalization and reporting are all written against the adapter interface and
 * need no change.
 *
 * Order matters only for fingerprinting: more specific providers are matched
 * before ones whose URL patterns could also match a generic subdomain.
 */
export const ADAPTERS: readonly ProviderAdapter[] = [
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workday,
  recruitee,
  workable,
  amazon,
];

const BY_ID = new Map<string, ProviderAdapter>(ADAPTERS.map((adapter) => [adapter.id, adapter]));

export function getAdapter(id: string): ProviderAdapter | undefined {
  return BY_ID.get(id);
}

export function adapterIds(): ProviderId[] {
  return ADAPTERS.map((adapter) => adapter.id);
}

export type { ProviderAdapter, ProviderId } from "./types.js";
