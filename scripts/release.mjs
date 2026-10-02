// Prepares the store zips the way a CI job would: refuses uncommitted changes and versions that are
// already tagged, then runs the tests and the lint, which builds both zips first.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function npm(...args) {
  execFileSync("npm", args, { cwd: ROOT, stdio: "inherit" });
}

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

// The build copies whole folders, so an untracked file in one would end up in the zip. A clean tree
// also means each zip matches a commit.
if (git("status", "--porcelain")) fail("commit or stash your changes first.");

const { version } = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8"));
if (git("tag", "--list", `v${version}`)) fail(`v${version} is already tagged. Bump "version" in manifest.json.`);

try {
  npm("test");
  npm("run", "lint");
} catch {
  fail("stopped, see the output above.");
}

console.log(`\nHall Pass ${version}, built from ${git("rev-parse", "--short", "HEAD")}, is ready to upload.`);
