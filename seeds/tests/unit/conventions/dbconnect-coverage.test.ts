/**
 * Every model operation is preceded by a connection call.
 *
 * WHAT HAPPENED
 *
 * Mongoose does not connect itself. A model op issued before `dbConnect()` on a
 * cold instance throws `Cannot call findOne() before initial connection is
 * complete` — and *only* on a cold instance. In development the connection is
 * already warm from the previous request, so the missing call is invisible;
 * locally it passes, in CI it passes, and it reaches production, where it fires
 * on the first request to hit a fresh lambda and then stops until the next cold
 * start. It is the definition of a failure that testing cannot find.
 *
 * The same class of bug is why the connection module also needs a readyState
 * check and `bufferCommands: true` — see `mongoose.md` in the patterns library.
 * This test covers only the call-site half.
 *
 * HOW IT DETECTS
 *
 * Not by grepping `.find(` — that collides with `Array.prototype.find` and a
 * guard that cries wolf gets deleted. Instead it resolves the model
 * *identifiers* a file imports from `MODEL_IMPORT_HINTS`, then looks for
 * `<Identifier>.<op>(`. A file that never imports a model is never flagged.
 *
 * This deliberately misses model ops reached through a variable or a helper
 * (`const M = getModel(); M.find()`). A widened match could only ever produce a
 * false FAILURE, and erring toward silence beats a test nobody trusts.
 *
 * THIS IS A `seeds/` FILE — IT IS YOURS. Adjust the import hints to wherever
 * your models live, and the op list to what you actually call.
 *
 * Run: npx tsx --test tests/unit/conventions/dbconnect-coverage.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { walkFiles, readSource, assertScanned } from "./source-scan";

const SCANNED_DIR = "src";

/** Raise as the repo grows; the sentinel nags when it has outgrown this. */
const SCAN_FLOOR = 3;

/** Path fragments that mean "this import is a Mongoose model". */
const MODEL_IMPORT_HINTS = ["/database/models", "/models/"] as const;

/** The connection call. Rename here if yours is called something else. */
const CONNECT_CALL = "dbConnect";

/** Operations that require a live connection. */
const MODEL_OPS = [
  "find",
  "findOne",
  "findById",
  "findByIdAndUpdate",
  "findOneAndUpdate",
  "create",
  "insertMany",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "countDocuments",
  "aggregate",
  "distinct",
  "bulkWrite",
] as const;

/**
 * Files exempt because they legitimately reference a model without touching the
 * database — schema definitions, type-only re-exports, seed fixtures.
 *
 * Empty on day 0. An entry here is a claim that the file does no I/O.
 */
const NO_IO_ALLOWANCE: readonly string[] = [];

const sourceFiles = walkFiles(SCANNED_DIR, [".ts", ".tsx"]);

/** Default and named identifiers imported from a model path, per file. */
function importedModelIdentifiers(source: string): string[] {
  const names: string[] = [];
  const importRe = /import\s+([^;]+?)\s+from\s+["']([^"']+)["']/g;

  for (const [, clause, spec] of source.matchAll(importRe)) {
    if (!MODEL_IMPORT_HINTS.some((hint) => spec.includes(hint))) continue;
    if (/^\s*type\s/.test(clause)) continue; // `import type` does no I/O

    // `Stylist`, `Stylist, { X }`, `{ A, B as C }` — take every binding.
    for (const [, name] of clause.matchAll(/([A-Z][A-Za-z0-9_]*)/g)) {
      names.push(name);
    }
  }
  return [...new Set(names)];
}

describe("model operations are preceded by a connection", () => {
  it("scanned a plausible number of files", () => {
    assertScanned(sourceFiles, {
      name: "dbconnect-coverage",
      dir: SCANNED_DIR,
      floor: SCAN_FLOOR,
    });
  });

  it("every file doing model I/O calls the connection helper", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      if (NO_IO_ALLOWANCE.includes(file)) continue;

      const source = readSource(file);
      const models = importedModelIdentifiers(source);
      if (models.length === 0) continue;

      const opRe = new RegExp(
        `\\b(${models.join("|")})\\s*\\.\\s*(${MODEL_OPS.join("|")})\\s*\\(`,
      );
      const hit = opRe.exec(source);
      if (!hit) continue;

      if (!source.includes(`${CONNECT_CALL}(`)) {
        const line = source.slice(0, hit.index).split("\n").length;
        offenders.push(`  ${file}:${line}  ${hit[1]}.${hit[2]}(...)`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `Model operation with no ${CONNECT_CALL}() in the file.\n` +
        `This throws ONLY on a cold instance, so it passes locally and in CI and\n` +
        `then fails in production on the first request to a fresh lambda.\n` +
        `Add \`await ${CONNECT_CALL}()\` before the first model op on every path,\n` +
        `including inside every cache work function.\n` +
        offenders.join("\n"),
    );
  });

  it("has no stale entries in NO_IO_ALLOWANCE", () => {
    const stale = NO_IO_ALLOWANCE.filter((f) => !sourceFiles.includes(f));
    assert.deepEqual(
      stale,
      [],
      `Listed in NO_IO_ALLOWANCE but no longer present:\n` +
        stale.map((f) => `  ${f}`).join("\n") +
        `\nRemove them — a stale allowance quietly widens next time a file of\n` +
        `that name reappears.`,
    );
  });
});
