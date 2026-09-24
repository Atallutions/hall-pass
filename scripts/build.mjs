// Builds a store package per browser: dist/<browser>/ holds the unpacked extension, and
// web-ext-artifacts/ the zip to upload. The root manifest.json works in both browsers for
// development; each store build drops the other browser's keys so neither store warns about them.
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const ARTIFACTS = join(ROOT, "web-ext-artifacts");
const WEB_EXT = join(ROOT, "node_modules", ".bin", "web-ext");

// Everything the extension loads. Tests, docs and tooling stay out of the package.
const FILES = ["background.js", "common.js", "common.css", "blocked", "options", "popup", "icons"];

const TARGETS = {
  chrome(manifest) {
    delete manifest.browser_specific_settings;
    delete manifest.background.scripts;
  },
  firefox(manifest) {
    delete manifest.background.service_worker;
  },
};

const requested = process.argv.slice(2);
const targets = requested.length ? requested : Object.keys(TARGETS);
for (const target of targets) {
  if (!TARGETS[target]) throw new Error(`Unknown target "${target}", expected one of: ${Object.keys(TARGETS).join(", ")}`);
}

const source = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8"));

for (const target of targets) {
  const outDir = join(DIST, target);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const file of FILES) {
    await cp(join(ROOT, file), join(outDir, file), {
      recursive: true,
      filter: (path) => !path.endsWith(".DS_Store"),
    });
  }

  const manifest = structuredClone(source);
  TARGETS[target](manifest);
  await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const filename = `hall-pass-${target}-${manifest.version}.zip`;
  execFileSync(
    WEB_EXT,
    ["build", "--source-dir", outDir, "--artifacts-dir", ARTIFACTS, "--filename", filename, "--overwrite-dest"],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  console.log(`${target}: web-ext-artifacts/${filename}`);
}
