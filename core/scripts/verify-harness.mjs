#!/usr/bin/env node
/**
 * Proves the test suite actually ran.
 *
 * THE HOLE THIS CLOSES
 *
 * `tsx --test "tests/unit/**\/*.test.ts"` exits 0 when the glob matches
 * nothing. Measured, not assumed:
 *
 *     $ npx tsx --test "tests/unit/does-not-exist/**\/*.test.ts"
 *     # tests 0
 *     # fail 0
 *     exit code: 0
 *
 * So on day 0 of a new repo `npm run verify` is green having executed nothing,
 * and it looks exactly like a healthy run. This is the disease the whole kit
 * exists to treat — an app that shipped 341 test files that no CI job ran —
 * reproducing itself one level up, in the harness, during the exact window
 * where habits form.
 *
 * There are two ways to lose the suite and this catches both:
 *
 *   1. The glob matches nothing (renamed directory, wrong path, fresh repo).
 *   2. The glob is UNQUOTED in package.json. `sh` does not expand `**`, so
 *      `tsx --test tests/unit/**\/*.test.ts` silently ran 44 of 725 tests in
 *      the source app while printing a green summary. A stale assertion merged
 *      with CI passing.
 *
 * A test cannot assert that tests ran, so this deliberately lives OUTSIDE
 * node:test and runs as its own step in the `verify` chain.
 *
 * PART OF `core/` — do not edit in a consuming repo.
 */

import { readdirSync, statSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const TEST_DIR = "tests/unit";
const MIN_TEST_FILES = 1;

function fail(message) {
  console.error(`\n[verify-harness] ${message}\n`);
  process.exit(1);
}

/** Recursively count *.test.ts under dir. */
function countTestFiles(dir) {
  let count = 0;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry === "node_modules") continue;
    const child = path.join(dir, entry);
    if (statSync(child).isDirectory()) count += countTestFiles(child);
    else if (entry.endsWith(".test.ts")) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// 1. There are test files at all.
// ---------------------------------------------------------------------------
const fileCount = countTestFiles(TEST_DIR);
if (fileCount < MIN_TEST_FILES) {
  fail(
    `Found ${fileCount} *.test.ts files under ${TEST_DIR}/, expected at least ${MIN_TEST_FILES}.\n` +
      `A suite with no files exits 0 and reads as passing. If you are setting up a\n` +
      `new repo, the kit's own convention tests should already be here — check that\n` +
      `install.mjs completed.`,
  );
}

// ---------------------------------------------------------------------------
// 2. The package.json glob is quoted.
//    An unquoted glob is expanded by the shell, which does not do globstar.
// ---------------------------------------------------------------------------
try {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const script = pkg.scripts?.["test:unit"] ?? "";
  if (script.includes("**") && !/["']/.test(script)) {
    fail(
      `The "test:unit" script contains an UNQUOTED glob:\n\n    ${script}\n\n` +
        `npm runs scripts through sh, which does not expand "**". The glob will match\n` +
        `only the files one level down and the run will still report success.\n` +
        `Fix: wrap the pattern in escaped double quotes.\n` +
        `    "test:unit": "tsx --test \\"tests/unit/**/*.test.ts\\""`,
    );
  }
} catch {
  // No package.json, or unparseable — step 1 and 3 still apply.
}

// ---------------------------------------------------------------------------
// 3. Run the suite and read the TAP trailer. Zero tests is a failure here even
//    though node:test considers it success.
// ---------------------------------------------------------------------------
const run = spawnSync(
  "npx",
  ["tsx", "--test", `${TEST_DIR}/**/*.test.ts`],
  { encoding: "utf8", shell: false },
);

const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
process.stdout.write(output);

const read = (label) => {
  const match = output.match(new RegExp(`^# ${label} (\\d+)$`, "m"));
  return match ? Number(match[1]) : null;
};

const tests = read("tests");
const failed = read("fail");

if (tests === null) {
  fail(
    `Could not find a "# tests" line in the runner output.\n` +
      `The suite may not have started at all. Exit code was ${run.status}.`,
  );
}

if (tests === 0) {
  fail(
    `The suite ran 0 tests but ${fileCount} test file(s) exist under ${TEST_DIR}/.\n` +
      `Files are present and none of them executed — the glob, the runner, or an\n` +
      `import-time throw is swallowing them. Run the command directly to see why:\n` +
      `    npx tsx --test "${TEST_DIR}/**/*.test.ts"`,
  );
}

if (failed !== null && failed > 0) {
  fail(`${failed} test(s) failed. See the output above.`);
}

if (run.status !== 0) {
  fail(`Runner exited ${run.status} despite reporting ${failed ?? 0} failures.`);
}

console.log(`\n[verify-harness] OK — ${tests} tests ran from ${fileCount} files, 0 failed.`);
