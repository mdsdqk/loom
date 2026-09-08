import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateResume } from "../../src/resume/schema.js";
import { loadResumeYaml } from "../../src/resume/yaml.js";

const fixturesDir = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

describe("validateResume", () => {
  it("accepts the reference fixture", async () => {
    const data = await loadResumeYaml(join(fixturesDir, "resume.yml"));
    const result = validateResume(data);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("parses multiline YAML block scalars in summary/introduction", async () => {
    const data = await loadResumeYaml(join(fixturesDir, "resume.yml"));
    const parsed = data as { summary: string; experience: Array<{ introduction?: string }> };
    expect(parsed.summary).toContain("Software Engineer");
    expect(parsed.experience[0].introduction).toContain("Technical lead");
  });

  it("defaults optional sections to empty arrays", () => {
    const result = validateResume({
      metadata: {
        name: "A",
        headline: "B",
        location: "C",
        email: "a@example.com",
      },
      summary: "S",
      experience: [
        {
          company: "Co",
          roles: ["Engineer"],
          dates: "2020",
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("reports a human-readable path for a missing required field", () => {
    const result = validateResume({
      metadata: { headline: "B", location: "C", email: "a@example.com" },
      summary: "S",
      experience: [{ company: "Co", roles: ["Engineer"], dates: "2020" }],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path === "metadata.name")).toBe(true);
  });

  it("reports a path for a wrong-typed array field", () => {
    const result = validateResume({
      metadata: { name: "A", headline: "B", location: "C", email: "a@example.com" },
      summary: "S",
      experience: [{ company: "Co", roles: "Engineer", dates: "2020" }],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path === "experience.0.roles")).toBe(true);
  });

  it("rejects experience missing required fields", () => {
    const result = validateResume({
      metadata: { name: "A", headline: "B", location: "C", email: "a@example.com" },
      summary: "S",
      experience: [{ roles: ["Engineer"], dates: "2020" }],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path === "experience.0.company")).toBe(true);
  });

  it("rejects a non-string bullet", () => {
    const result = validateResume({
      metadata: { name: "A", headline: "B", location: "C", email: "a@example.com" },
      summary: "S",
      experience: [{ company: "Co", roles: ["Engineer"], dates: "2020", bullets: ["ok", 5] }],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path === "experience.0.bullets.1")).toBe(true);
  });
});
