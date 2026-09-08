import { cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const toolsDir = dirname(dirname(fileURLToPath(import.meta.url)));

for (const dir of ["templates", "styles"]) {
  cpSync(join(toolsDir, "src", "resume", dir), join(toolsDir, "dist", "resume", dir), {
    recursive: true,
  });
}
