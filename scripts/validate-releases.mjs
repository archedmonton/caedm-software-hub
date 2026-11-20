import { readFileSync } from "node:fs";
import ts from "typescript";
// Use the installed compiler so validation also works on the documented Node
// 22.12 baseline, where native TypeScript imports are not enabled by default.
async function loadMetadata(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
  );
}
const { releases } = await loadMetadata("../src/lib/releases.ts");
const { validateReleases } = await loadMetadata(
  "../src/lib/release-validation.ts",
);
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const errors = validateReleases(pkg.version, releases);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Release metadata validated: ${pkg.version} (${releases[0].status})`,
  );
