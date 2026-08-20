/**
 * Feature gates ask about capabilities, never about tier names.
 *
 * WHAT HAPPENED
 *
 * `if (tier === "pro")` is a *tier* predicate answering a *capability*
 * question. It is correct on the day it is written. The day a second paying
 * tier ships, every one of these silently locks out customers who paid for the
 * feature — and nothing fails, because the check still does exactly what it
 * says. There is no error, no test failure, and no log line; the feature is
 * simply absent for people who bought it.
 *
 * In the app this kit came from, that ladder bit three separate times. The
 * near-miss that produced this test was a background-automation gate almost
 * written as `isPro()`, which is `false` for a paying mid-tier. It was caught in
 * review by one person recognising the shape. That is not a control.
 *
 * THE FIX IS ALWAYS THE SAME
 *
 * Name the capability, and put the predicate in one module:
 *
 *     // not isPro() — "pro" is a price point, this is a question about automation
 *     export function hasPaidAutomation(account: PlanGate): boolean { … }
 *
 * Each predicate gets a docblock naming the bug it prevents, or the next reader
 * will helpfully collapse three of them back into one.
 *
 * Note the direction of pressure: every incident here wants you to add one more
 * `||` to an existing predicate. One more `||` is exactly how the next tier gets
 * locked out. Add a narrower predicate instead.
 *
 * THIS IS A `seeds/` FILE — IT IS YOURS. Point ENTITLEMENTS_MODULE at wherever
 * your predicates live and add your own plan field names to GATE_FIELDS.
 *
 * Run: npx tsx --test tests/unit/conventions/entitlement-predicates.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { walkFiles, readSource, assertScanned } from "./source-scan";

const SCANNED_DIR = "src";

/** Raise as the repo grows; the sentinel nags when it has outgrown this. */
const SCAN_FLOOR = 3;

/**
 * The one place tier names may legally be compared. Everywhere else asks a
 * capability predicate exported from here.
 *
 * Path fragment, matched against the file path.
 */
const ENTITLEMENTS_MODULE = "/access/";

/** Field names whose values are tier/plan identifiers. */
const GATE_FIELDS = ["tier", "plan", "planCode", "subscriptionTier"] as const;

/**
 * Files that compare a tier name outside the entitlements module and are
 * allowed to. Each entry is a claim that the comparison is NOT a feature gate —
 * a billing display, an admin filter, a migration.
 *
 * Empty on day 0.
 */
const NON_GATE_ALLOWANCE: readonly string[] = [];

const sourceFiles = walkFiles(SCANNED_DIR, [".ts", ".tsx"]);

/**
 * `tier === "pro"` / `plan !== 'max'`, including optional-chained and nested
 * forms (`account.plan === "..."`). Only string-literal comparisons — comparing
 * two variables is not the shape that hardcodes a tier name.
 */
const TIER_COMPARISON = new RegExp(
  `\\b(?:${GATE_FIELDS.join("|")})\\s*[=!]==?\\s*["'\`][^"'\`]+["'\`]`,
  "g",
);

describe("gates ask about capabilities, not tiers", () => {
  it("scanned a plausible number of files", () => {
    assertScanned(sourceFiles, {
      name: "entitlement-predicates",
      dir: SCANNED_DIR,
      floor: SCAN_FLOOR,
    });
  });

  it("compares tier names only inside the entitlements module", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      if (file.includes(ENTITLEMENTS_MODULE)) continue;
      if (NON_GATE_ALLOWANCE.includes(file)) continue;

      const source = readSource(file);
      for (const match of source.matchAll(TIER_COMPARISON)) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`  ${file}:${line}  ${match[0]}`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `Tier-name comparison outside the entitlements module.\n` +
        `This is a tier predicate answering a capability question: it is correct\n` +
        `today and silently locks out paying customers the day a second paid tier\n` +
        `ships, with nothing failing.\n` +
        `Add a named capability predicate in "${ENTITLEMENTS_MODULE}" and call that.\n` +
        `If this comparison genuinely is not a feature gate (billing display,\n` +
        `admin filter), add the file to NON_GATE_ALLOWANCE with a comment saying why.\n` +
        offenders.join("\n"),
    );
  });

  it("has no stale entries in NON_GATE_ALLOWANCE", () => {
    const stale = NON_GATE_ALLOWANCE.filter((f) => !sourceFiles.includes(f));
    assert.deepEqual(
      stale,
      [],
      `Listed in NON_GATE_ALLOWANCE but no longer present:\n` +
        stale.map((f) => `  ${f}`).join("\n"),
    );
  });
});
