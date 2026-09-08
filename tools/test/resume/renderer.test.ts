import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildResume, defaultResumePdfPath } from "../../src/resume/build.js";
import { renderResumeHtml, renderResumePdf } from "../../src/resume/renderer.js";
import { ResumeSchema } from "../../src/resume/schema.js";
import { loadResumeYaml } from "../../src/resume/yaml.js";

const fixturesDir = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

describe("renderResumeHtml", () => {
  it("includes every top-level section for the reference fixture", async () => {
    const data = await loadResumeYaml(join(fixturesDir, "resume.yml"));
    const resume = ResumeSchema.parse(data);
    const html = await renderResumeHtml(resume);

    expect(html).toContain("Alex Example");
    expect(html).toContain("Software Engineer with 15+ years");
    expect(html).toContain("Work Experience");
    expect(html).toContain("Skills");
    expect(html).toContain("Projects");
    expect(html).toContain("Education");
    expect(html).toContain("Recognition");
    expect(html).toContain("Example Fintech");
    expect(html).toContain("Winner of an internal hackathon.");
    expect(html).toContain('<a href="https://example.com">Live</a>');
    expect(html).toContain('<a href="https://github.com/example/project">Repo</a>');
  });

  it("converts **bold** markers to <strong> in bullets/introduction/summary and escapes the rest", async () => {
    const data = await loadResumeYaml(join(fixturesDir, "resume.yml"));
    const resume = ResumeSchema.parse(data);
    resume.experience[0].introduction = "Led a **critical** initiative";
    resume.experience[0].bullets[0] = "Shipped **fast** & <important> work";
    const html = await renderResumeHtml(resume);

    expect(html).toContain("Led a <strong>critical</strong> initiative");
    expect(html).toContain("Shipped <strong>fast</strong> &amp; &lt;important&gt; work");
  });

  it("linkifies email/linkedin/github in the header contact line", async () => {
    const data = await loadResumeYaml(join(fixturesDir, "resume.yml"));
    const resume = ResumeSchema.parse(data);
    const html = await renderResumeHtml(resume);

    expect(html).toContain('<a href="mailto:alex@example.com">gmail/alexexample</a>');
    expect(html).toContain('<a href="https://linkedin.com/in/alexexample">linkedin/alexexample</a>');
    expect(html).toContain('<a href="https://example.com">www/example</a>');
    expect(html).toContain('<a href="https://github.com/alexexample">github/alexexample</a>');
  });

  it("does not mutate the source YAML data", async () => {
    const data = await loadResumeYaml(join(fixturesDir, "resume.yml"));
    const resume = ResumeSchema.parse(data);
    const snapshot = JSON.stringify(resume);
    await renderResumeHtml(resume);
    expect(JSON.stringify(resume)).toBe(snapshot);
  });
});

describe("defaultResumePdfPath", () => {
  it("includes the candidate and opportunity slugs for opportunity artifacts", () => {
    expect(defaultResumePdfPath("C:/source/opportunities/maersk-full-stack-ai-engineer/artifacts/resume.yml", "Sadiq", "Full Stack AI Engineer"))
      .toBe(resolve("C:/source/opportunities/maersk-full-stack-ai-engineer/artifacts/resume-sadiq-full-stack-ai-engineer.pdf"));
  });

  it("uses only the candidate slug outside opportunity artifacts", () => {
    expect(defaultResumePdfPath("C:/source/candidate/resume.yml", "Alex Example"))
      .toBe(resolve("C:/source/candidate/resume-alex-example.pdf"));
  });
});

describe("renderResumePdf", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loom-resume-pdf-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a PDF at the expected path", async () => {
    const data = await loadResumeYaml(join(fixturesDir, "resume.yml"));
    const resume = ResumeSchema.parse(data);
    const outPath = join(dir, "resume.pdf");

    await renderResumePdf(resume, outPath);

    const stats = await stat(outPath);
    expect(stats.size).toBeGreaterThan(0);
    const header = await readFile(outPath, { encoding: "latin1", flag: "r" });
    expect(header.startsWith("%PDF-")).toBe(true);
  }, 30000);

  it("a failed build does not destroy a previously valid PDF", async () => {
    const outPath = join(dir, "resume.pdf");
    await writeFile(outPath, "existing-valid-pdf-bytes");

    const invalidYamlPath = join(dir, "resume.yml");
    await writeFile(invalidYamlPath, "metadata: {}\nsummary: \"\"\nexperience: []\n");

    const result = await buildResume(invalidYamlPath, outPath);
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);

    const contentsAfter = await readFile(outPath, "utf8");
    expect(contentsAfter).toBe("existing-valid-pdf-bytes");
  });

  it("buildResume renders a valid resume.yml end to end", async () => {
    const yamlPath = join(fixturesDir, "resume.yml");
    const outPath = join(dir, "resume.pdf");
    const result = await buildResume(yamlPath, outPath);
    expect(result.ok).toBe(true);
    const stats = await stat(outPath);
    expect(stats.size).toBeGreaterThan(0);
  }, 30000);

  it("produces multi-page output for a long resume", async () => {
    const data = await loadResumeYaml(join(fixturesDir, "resume.yml"));
    const base = ResumeSchema.parse(data);
    const longResume = {
      ...base,
      experience: Array.from({ length: 8 }, (_, index) => ({
        ...base.experience[0],
        company: `${base.experience[0].company} ${index}`,
        bullets: Array.from({ length: 8 }, (_, bulletIndex) => `Bullet ${index}-${bulletIndex} `.repeat(6)),
      })),
    };
    const outPath = join(dir, "resume-long.pdf");
    await renderResumePdf(longResume, outPath);
    const stats = await stat(outPath);
    expect(stats.size).toBeGreaterThan(0);
  }, 30000);
});
