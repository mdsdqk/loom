import { readFile } from "node:fs/promises";
import { parse } from "yaml";

/** Reads and parses a resume.yml file into an untyped value — callers narrow it via ResumeSchema. */
export async function loadResumeYaml(path: string): Promise<unknown> {
  const text = await readFile(path, "utf8");
  return parse(text);
}
