#!/usr/bin/env node
import { emitYaml, parseCliArgs } from "./yaml.js";
import { parsePdf } from "./pdf-parse.js";

async function main() {
  const { input, outPath, stdout } = parseCliArgs(process.argv.slice(2));
  const parsed = await parsePdf(input);
  await emitYaml(input, parsed, { outPath, stdout });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
