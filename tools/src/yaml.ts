import { writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import yaml from "js-yaml";

export interface OutputOptions {
  /** Explicit output path. If omitted, defaults to the input path with a .yaml extension. */
  outPath?: string;
  /** Print to stdout instead of writing a file. */
  stdout?: boolean;
}

export function defaultYamlPath(inputPath: string): string {
  const name = basename(inputPath, extname(inputPath));
  return join(dirname(inputPath), `${name}.yaml`);
}

export async function emitYaml(
  inputPath: string,
  data: unknown,
  options: OutputOptions
): Promise<void> {
  const text = yaml.dump(data, { lineWidth: 100 });
  if (options.stdout) {
    process.stdout.write(text);
    return;
  }
  const outPath = options.outPath ?? defaultYamlPath(inputPath);
  await writeFile(outPath, text, "utf8");
  process.stderr.write(`Wrote ${outPath}\n`);
}

export function parseCliArgs(argv: string[]): {
  input: string;
  outPath?: string;
  stdout: boolean;
} {
  const args = [...argv];
  let outPath: string | undefined;
  let stdout = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-o" || arg === "--output") {
      outPath = args[++i];
    } else if (arg === "--stdout") {
      stdout = true;
    } else {
      positional.push(arg);
    }
  }

  const input = positional[0];
  if (!input) {
    throw new Error("Missing required <input> file argument");
  }
  return { input, outPath, stdout };
}
