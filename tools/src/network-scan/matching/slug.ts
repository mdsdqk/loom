import { createHash } from "node:crypto";

/**
 * Human-readable, URL-safe slugs for match rows.
 *
 * `Job.id` (provider:providerJobId, a canonical URL, or a digest) is stable
 * and unique, but it means nothing to a candidate skimming a list. A slug
 * built from company and title is readable, at the cost of no longer being
 * guaranteed unique on its own — two different postings can share a company
 * and title (see `collapseVariants` for when that is even the point).
 * `assignSlugs` is what restores uniqueness without losing readability.
 */

const MAX_SLUG_LENGTH = 80;

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
  // Company and title are free text; either can be entirely punctuation once
  // stripped (rare, but seen on malformed listings). A blank slug would still
  // need to collide-and-disambiguate like any other, so give it something to
  // start from.
  return slug || "job";
}

/** Short, stable suffix derived from the posting's own id. */
function disambiguator(id: string): string {
  return createHash("sha1").update(id).digest("hex").slice(0, 6);
}

export interface SlugInput {
  id: string;
  company: string;
  title: string;
}

/**
 * Assigns a slug to every row, unique within the input set.
 *
 * Collisions are resolved by suffixing *every* member of the colliding group
 * with a hash of its own id — not by numbering them in the order they happen
 * to appear. A counter ("-2", "-3") makes the slug depend on iteration order:
 * two runs over the exact same jobs, differing only in which one the sort
 * happened to place first, would then hand out different slugs for the same
 * posting. Hashing the id instead means the same job always gets the same
 * slug, regardless of what else is in the run.
 */
export function assignSlugs(rows: SlugInput[]): Map<string, string> {
  const base = new Map<string, string>();
  for (const row of rows) {
    base.set(row.id, slugify(`${row.company}-${row.title}`));
  }

  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const key = base.get(row.id)!;
    const group = groups.get(key);
    if (group) group.push(row.id);
    else groups.set(key, [row.id]);
  }

  const slugs = new Map<string, string>();
  for (const [key, ids] of groups) {
    if (ids.length === 1) {
      slugs.set(ids[0], key);
      continue;
    }
    for (const id of ids) {
      slugs.set(id, `${key}-${disambiguator(id)}`);
    }
  }
  return slugs;
}
