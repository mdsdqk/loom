import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import { loadDomainRegistry, saveDomainRegistry } from "../src/network-scan/registry.js";

async function scratchFile(name: string): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "loom-registry-")), name);
}

describe("loadDomainRegistry", () => {
  it("keys entries by normalized company name so variants still hit", async () => {
    const path = await scratchFile("registry.yml");
    await writeFile(
      path,
      yaml.dump({
        companies: [
          { company: "Contoso Systems Private Limited", domain: "contoso.com" },
          { company: "Fabrikam - An Initech Company", domain: "fabrikam.io" },
        ],
      }),
      "utf8"
    );

    const registry = await loadDomainRegistry(path);

    expect(registry.get("contoso systems")).toBe("contoso.com");
    expect(registry.get("fabrikam")).toBe("fabrikam.io");
  });

  it("lowercases and trims domains", async () => {
    const path = await scratchFile("registry.yml");
    await writeFile(
      path,
      yaml.dump({ companies: [{ company: "Acme", domain: "  ACME.COM  " }] }),
      "utf8"
    );

    expect((await loadDomainRegistry(path)).get("acme")).toBe("acme.com");
  });

  it("returns empty rather than throwing for a missing or malformed file", async () => {
    expect((await loadDomainRegistry(await scratchFile("nope.yml"))).size).toBe(0);

    const broken = await scratchFile("broken.yml");
    await writeFile(broken, "companies: not-a-list\n", "utf8");
    expect((await loadDomainRegistry(broken)).size).toBe(0);
  });

  it("skips entries missing a company or a domain", async () => {
    const path = await scratchFile("registry.yml");
    await writeFile(
      path,
      yaml.dump({
        companies: [
          { company: "Good Co", domain: "good.com" },
          { company: "No Domain" },
          { domain: "orphan.com" },
        ],
      }),
      "utf8"
    );

    const registry = await loadDomainRegistry(path);
    expect(registry.size).toBe(1);
    expect(registry.get("good")).toBe("good.com");
  });
});

describe("saveDomainRegistry", () => {
  it("adds new entries and reports how many were added", async () => {
    const path = await scratchFile("registry.yml");

    const added = await saveDomainRegistry(path, new Map(), [
      { company: "Razorpay", domain: "razorpay.com" },
      { company: "Okta", domain: "okta.com" },
    ]);

    expect(added).toBe(2);
    expect((await loadDomainRegistry(path)).get("razorpay")).toBe("razorpay.com");
  });

  it("never overwrites an existing mapping — hand edits outrank discovery", async () => {
    const path = await scratchFile("registry.yml");
    const existing = new Map([["razorpay", "razorpay-curated.com"]]);

    const added = await saveDomainRegistry(path, existing, [
      { company: "Razorpay", domain: "razorpay-guessed.com" },
    ]);

    expect(added).toBe(0);
    expect((await loadDomainRegistry(path)).get("razorpay")).toBe("razorpay-curated.com");
  });

  it("writes entries in a stable order so the checked-in file diffs cleanly", async () => {
    const first = await scratchFile("a.yml");
    const second = await scratchFile("b.yml");
    const discovered = [
      { company: "Zeta", domain: "zeta.com" },
      { company: "Alpha", domain: "alpha.com" },
      { company: "Middle", domain: "middle.com" },
    ];

    await saveDomainRegistry(first, new Map(), discovered);
    await saveDomainRegistry(second, new Map(), [...discovered].reverse());

    expect(await readFile(first, "utf8")).toBe(await readFile(second, "utf8"));
  });

  it("deduplicates repeated companies within one batch", async () => {
    const path = await scratchFile("registry.yml");

    const added = await saveDomainRegistry(path, new Map(), [
      { company: "Acme Inc.", domain: "acme.com" },
      { company: "Acme, Inc", domain: "acme-other.com" },
    ]);

    expect(added).toBe(1);
    expect((await loadDomainRegistry(path)).get("acme")).toBe("acme.com");
  });

  it("keeps a readable header explaining the file", async () => {
    const path = await scratchFile("registry.yml");
    await saveDomainRegistry(path, new Map(), [{ company: "Acme", domain: "acme.com" }]);

    const text = await readFile(path, "utf8");
    expect(text.startsWith("#")).toBe(true);
    expect(text).toContain("Hand-edited entries take priority");
  });
});
