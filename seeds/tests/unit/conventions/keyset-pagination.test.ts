/**
 * Collection queries paginate by cursor, not by offset.
 *
 * WHY
 *
 * `skip(n)` is O(n). The server walks and discards every skipped document
 * before returning one — MongoDB's own reference for `cursor.skip` says so
 * plainly. Page 1 is instant and page 500 scans 500 pages' worth of documents,
 * so the cost is invisible in development, invisible in review, and invisible
 * in testing, because nobody opens page 500. It shows up as a feed that gets
 * slower the longer someone scrolls, which reads as "the app is slow" rather
 * than as a specific bug with a specific fix.
 *
 * Unlike most rules in this kit this one is doc-derived rather than
 * incident-derived — it is here because the pattern library it ships beside
 * previously taught `skip()` with no caveat.
 *
 * THE FIX
 *
 *     const filter = after ? { ...query, _id: { $lt: after } } : query;
 *     const page = await Model.find(filter).sort({ _id: -1 }).limit(size);
 *     const nextCursor = page.length === size ? page.at(-1)._id : null;
 *
 * Index to match the sort. For a ranked feed use a compound `{ score, _id }` so
 * the tiebreak is stable — a sort key with ties and no tiebreak silently repeats
 * and drops rows across page boundaries.
 *
 * WHEN `skip()` IS STILL RIGHT
 *
 * A numbered-page admin table over a bounded collection, where the operator can
 * see the page count and the depth is small. Do not contort that into a cursor —
 * add the file to OFFSET_ALLOWANCE instead.
 *
 * THIS IS A `seeds/` FILE — IT IS YOURS.
 *
 * Run: npx tsx --test tests/unit/conventions/keyset-pagination.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { walkFiles, readSource, assertScanned } from "./source-scan";

const SCANNED_DIR = "src";

/** Raise as the repo grows; the sentinel nags when it has outgrown this. */
const SCAN_FLOOR = 3;

/**
 * Files that paginate by offset deliberately. Each entry is a claim that the
 * collection is bounded and the depth is small — an admin table, not a feed.
 *
 * Empty on day 0.
 */
const OFFSET_ALLOWANCE: readonly string[] = [];

const sourceFiles = walkFiles(SCANNED_DIR, [".ts", ".tsx"]);

/**
 * `.skip(` — but not the test-runner forms (`it.skip`, `describe.skip`,
 * `test.skip`), which are unrelated and would otherwise make this cry wolf in
 * any colocated test file.
 */
const RUNNER_SKIP = /\b(?:it|test|describe|suite)\s*\.\s*skip\s*\(/;

describe("collection queries paginate by cursor", () => {
  it("scanned a plausible number of files", () => {
    assertScanned(sourceFiles, {
      name: "keyset-pagination",
      dir: SCANNED_DIR,
      floor: SCAN_FLOOR,
    });
  });

  it("never offsets with skip()", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      if (OFFSET_ALLOWANCE.includes(file)) continue;

      const source = readSource(file);
      const lines = source.split("\n");

      lines.forEach((text, i) => {
        if (!/\.\s*skip\s*\(/.test(text)) return;
        if (RUNNER_SKIP.test(text)) return;
        offenders.push(`  ${file}:${i + 1}  ${text.trim().slice(0, 100)}`);
      });
    }

    assert.deepEqual(
      offenders,
      [],
      `Offset pagination via skip().\n` +
        `skip(n) is O(n): the server walks and discards every skipped document,\n` +
        `so deep pages degrade in a way that never shows up in testing.\n` +
        `Paginate on an immutable sort key instead:\n` +
        `  { _id: { $lt: cursor } } + .sort({ _id: -1 }).limit(size)\n` +
        `If this is a bounded admin table, add the file to OFFSET_ALLOWANCE\n` +
        `with a comment saying why the depth is safe.\n` +
        offenders.join("\n"),
    );
  });

  it("has no stale entries in OFFSET_ALLOWANCE", () => {
    const stale = OFFSET_ALLOWANCE.filter((f) => !sourceFiles.includes(f));
    assert.deepEqual(
      stale,
      [],
      `Listed in OFFSET_ALLOWANCE but no longer present:\n` +
        stale.map((f) => `  ${f}`).join("\n"),
    );
  });
});
