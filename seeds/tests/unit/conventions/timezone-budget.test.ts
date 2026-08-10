/**
 * Every date/time format call must pin an explicit `timeZone`.
 *
 * WHY — AND WHY THIS ONE SHIPS ACTIVE ON DAY 0
 *
 * `toLocaleDateString()` without a `timeZone` formats against UTC on the server
 * and against the viewer's local zone in the browser. Near a day boundary the
 * weekday and the day-of-month diverge, React sees different markup on the two
 * passes, and you get a hydration mismatch.
 *
 * In the source app this shipped FOUR SEPARATE TIMES — 05-17 twice, 06-15, and
 * 07-09 — with the correct fix written down after each one. That is the whole
 * argument for this kit in a single bug.
 *
 * The kit's general rule is that a lint rule must come with the commit that
 * justifies it, and that bar is deliberately high. This rule clears a modified
 * bar: the incident is STACK-LEVEL and INEVITABLE, not app-specific. Any
 * server-rendered app on a UTC host serving a single-country audience will meet
 * it. Re-earning a bug that already cost four incidents elsewhere is not
 * evidence-gathering, it is amnesia.
 *
 * BUDGET 0 = A BAN, AND DELIBERATELY NO HONESTY HALF
 *
 * A fresh repo has zero unpinned sites, so the budget is 0 and this is an
 * absolute. Note what is ABSENT: the companion `found.length >= BUDGET - SLACK`
 * assertion that a mature repo carries. At BUDGET 0 / SLACK 3 that reads
 * `>= -3` — no input could ever fail it, while rendering as a live green test.
 * `_kit-selfcheck.test.ts` fails the build if anyone adds it back at budget 0.
 * `install.mjs --baseline` restores it when it measures a nonzero baseline.
 *
 * This is a `seeds/` file — it is YOURS. Set APP_TIME_ZONE to your app's zone.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  walkFiles,
  readSource,
  assertScanned,
  findCallsMissingArgument,
  formatSites,
} from "./source-scan";

const SCANNED_DIR = "src";
const SCAN_FLOOR = 3;

/**
 * The single home for the app's zone. Set this at install time.
 * Every other module imports it — see the second test.
 */
const ZONE_MODULE = "src/lib/datetime.ts";

const DATE_CALLS = [
  ".toLocaleDateString",
  ".toLocaleTimeString",
  ".toLocaleString",
  "Intl.DateTimeFormat",
] as const;

const sourceFiles = walkFiles(SCANNED_DIR, [".ts", ".tsx"]);
const unpinned = findCallsMissingArgument(sourceFiles, DATE_CALLS, "timeZone");

describe("timezone budget", () => {
  it("finds source to scan at all", () => {
    assertScanned(sourceFiles, {
      name: "timezone-budget",
      dir: SCANNED_DIR,
      floor: SCAN_FLOOR,
    });
  });

  it("pins a timeZone on every date format", () => {
    assert.deepEqual(
      unpinned.map((s) => `${s.file}:${s.line}`),
      [],
      `Date format call(s) with no explicit timeZone:\n${formatSites(unpinned)}\n\n` +
        `Why this matters: the server formats against UTC and the browser against the\n` +
        `viewer's local zone. Near midnight they disagree, and React throws a hydration\n` +
        `mismatch. This shipped four times in the app this rule came from.\n` +
        `How to fix: pass the zone explicitly —\n` +
        `    d.toLocaleDateString("en-ZA", { timeZone: APP_TIME_ZONE, dateStyle: "medium" })\n` +
        `importing APP_TIME_ZONE from ${ZONE_MODULE}.`,
    );
  });

  it("keeps the zone literal in exactly one module", () => {
    // A zone string copied into three files is three places to miss on a change,
    // and the source app had exactly that before consolidating.
    const zonePattern = /["'][A-Za-z]+\/[A-Za-z_]+["']/;
    const strays = sourceFiles
      .filter((f) => f !== ZONE_MODULE)
      .filter((f) => {
        const source = readSource(f);
        return DATE_CALLS.some((c) => source.includes(c)) && zonePattern.test(source);
      });

    assert.deepEqual(
      strays,
      [],
      `A timezone literal appears outside ${ZONE_MODULE}:\n  ${strays.join("\n  ")}\n\n` +
        `Export one APP_TIME_ZONE constant and import it, so changing the zone is one edit.`,
    );
  });
});
