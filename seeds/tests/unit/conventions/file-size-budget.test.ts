/**
 * No source file may exceed 800 lines.
 *
 * WHY
 *
 * In the app this kit came from, the four largest modules were four of the five
 * most fix-touched files in the repo. Size and defect rate tracked each other
 * closely enough that capping size was the cheapest available intervention.
 *
 * A concrete example of the ratchet doing architectural work: a monolithic
 * `validations.ts` reached 1,436 lines because it gained a line for every
 * feature flag ever shipped. While it sat over the cap, no flag could be added
 * without failing this test — which is what finally forced the split into
 * `validations/<domain>.ts`.
 *
 * DAY-0 SHAPE: A BAN, NOT A RATCHET
 *
 * The allowance map below is EMPTY, and that is correct. "Ratchet, don't ban"
 * is a RETROFIT rule — it exists because the source app had 16 oversize files
 * before this test existed, and a flat ban would have failed on day one and been
 * deleted within a week. A new repo has no inherited debt, so day 0 is the one
 * moment an absolute is affordable.
 *
 * If you drop this kit into an EXISTING repo, run `install.mjs --baseline`. It
 * measures the repo and writes the allowance map, at which point this becomes a
 * true ratchet and the two staleness assertions below start earning their keep.
 *
 * This is a `seeds/` file — it is YOURS. Edit the cap, the scanned dirs, and the
 * allowance map freely.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { walkFiles, readSource, assertScanned } from "./source-scan";

const MAX_LINES = 800;
const SCANNED_DIR = "src";

/** Raise as the repo grows; the sentinel nags when it has outgrown this. */
const SCAN_FLOOR = 3;

/**
 * Files that exceeded the cap before it existed, with the line count measured
 * when they were baselined. Each may shrink but never grow.
 *
 * Empty on day 0. `install.mjs --baseline` fills it during a retrofit.
 * When you genuinely extract code, LOWER the number — never raise it.
 */
const OVERSIZE_ALLOWANCE: Readonly<Record<string, number>> = {};

const lineCounts = new Map<string, number>();
const sourceFiles = walkFiles(SCANNED_DIR, [".ts", ".tsx"]);
for (const file of sourceFiles) {
  lineCounts.set(file, readSource(file).split("\n").length);
}

describe("file size budget", () => {
  it("finds source to scan at all", () => {
    assertScanned(sourceFiles, {
      name: "file-size-budget",
      dir: SCANNED_DIR,
      floor: SCAN_FLOOR,
    });
  });

  it("admits no new file over the cap", () => {
    const offenders = [...lineCounts.entries()]
      .filter(([file, n]) => n > MAX_LINES && !(file in OVERSIZE_ALLOWANCE))
      .map(([file, n]) => `  ${file}: ${n} lines`);

    assert.deepEqual(
      offenders,
      [],
      `File(s) over the ${MAX_LINES}-line cap:\n${offenders.join("\n")}\n\n` +
        `Why this matters: the largest modules in the app this rule came from were also the\n` +
        `most defect-prone, and a god file makes every future change harder to review.\n` +
        `How to fix: extract a cohesive slice into its own module. Do NOT add the file to\n` +
        `OVERSIZE_ALLOWANCE — that list is for debt inherited before the rule existed.`,
    );
  });

  it("never lets an existing oversize file grow", () => {
    const grown: string[] = [];
    for (const [file, allowed] of Object.entries(OVERSIZE_ALLOWANCE)) {
      const actual = lineCounts.get(file);
      if (actual === undefined) continue; // Deleted or moved; the staleness test reports it.
      if (actual > allowed) {
        grown.push(`  ${file}: ${actual} lines, allowance ${allowed} (+${actual - allowed})`);
      }
    }

    assert.deepEqual(
      grown,
      [],
      `An oversize file grew:\n${grown.join("\n")}\n\n` +
        `The rule for a file on this list is "extract at least as much as you add".\n` +
        `Raising the allowance is how the ratchet slips; lower it instead.`,
    );
  });

  it("keeps the allowance list free of stale entries", () => {
    // SLACK exists so this check cannot become the thing everyone disables.
    // Demanding an exact match would fail on any unrelated commit that trimmed
    // a line — and a guard that cries wolf gets deleted, after which it
    // enforces nothing. Only a real extraction trips it.
    const SLACK = 25;
    const stale: string[] = [];

    for (const [file, allowed] of Object.entries(OVERSIZE_ALLOWANCE)) {
      const actual = lineCounts.get(file);
      if (actual === undefined) {
        stale.push(`${file}: no longer exists — remove it from OVERSIZE_ALLOWANCE`);
      } else if (actual <= MAX_LINES) {
        stale.push(
          `${file}: now ${actual} lines, under the ${MAX_LINES} cap — remove it from OVERSIZE_ALLOWANCE entirely`,
        );
      } else if (actual < allowed - SLACK) {
        stale.push(
          `${file}: now ${actual} lines vs allowance ${allowed} — lower the allowance to ${actual} to bank the win`,
        );
      }
    }

    assert.deepEqual(
      stale,
      [],
      `The allowance list is out of date:\n  ${stale.join("\n  ")}\n\n` +
        `Note the line count is split("\\n").length, which is \`wc -l\` + 1. Use the number\n` +
        `this test reports, or you will be off by exactly one.`,
    );
  });
});
