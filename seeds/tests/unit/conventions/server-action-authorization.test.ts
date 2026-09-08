/**
 * A server action that writes must authorize its caller.
 *
 * WHAT HAPPENED
 *
 * A `"use server"` module is not a private module. The framework assigns every
 * export a stable action id and will execute it on a POST to any route in the
 * app. The page that renders the button is irrelevant: gating the page gates
 * the button, not the endpoint.
 *
 * In the app this kit came from, that was missed twice in one sweep, and the
 * prose rule was already written down both times:
 *
 *   - A subscription-repair action disabled live payment-provider subscriptions
 *     and rewrote the plan tier on every account, with no guard of any kind.
 *     Its only caller sat behind an admin page guard, which protected the page
 *     and nothing else. Anyone who knew the action id could mass-mutate paid
 *     subscriptions.
 *
 *   - The transactional-email module carried the directive at line 1, making
 *     `sendEmail({ to, subject, html, attachments })` a public endpoint with no
 *     auth, no rate limit and no recipient allowlist — sending from the app's
 *     own verified domain. An open relay against its own sending reputation.
 *     Nothing needed the directive; every importer was server-side. The fix was
 *     to delete it.
 *
 * Neither was carelessness. Adherence was 84 of 85 files at the time. That is
 * what an unenforced rule looks like after a few thousand commits: it holds
 * almost everywhere, and the one place it doesn't is invisible precisely
 * because everything around it is correct.
 *
 * WHY THIS SHIPS ACTIVE ON DAY 0
 *
 * Unlike `dbconnect-coverage`, which needs a population before its floor means
 * anything, this rule is dangerous from the FIRST action file. One unguarded
 * write is a complete vulnerability, not a trend. The floor below only proves
 * the scan is alive; it is not a maturity gate.
 *
 * WHY GUARDS ARE ENUMERATED, NOT PATTERN-MATCHED
 *
 * A mature app accumulates authorization entry points across several naming
 * families — `require*`, `assert*`, `verify*`. The source app had 37. A regex
 * loose enough to cover them all matches feature flags and env checks too, and
 * reports a file as guarded when it merely asked whether a feature was ON.
 * That false pass is worse than no test.
 *
 * So `GUARDS` is a list you maintain. Adding to it is the moment someone asks
 * whether the new function actually authorizes anything — which is the review
 * this test exists to force.
 *
 * THIS IS A `seeds/` FILE — IT IS YOURS. Point GUARDS at your own
 * authorization helpers and add pre-auth entry points to PRE_AUTH_ALLOWANCE.
 *
 * Run: npx tsx --test tests/unit/conventions/server-action-authorization.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assertScanned, readSource, walkFiles } from "./source-scan";

/**
 * Calls that establish WHO is acting.
 *
 * A feature flag is not a guard. `assertBillingEnabled()` answers "is this
 * feature on", never "may this caller do it" — listing one here would make
 * every gated action read as authorized.
 *
 * Replace these with your own. The defaults cover a NextAuth + role-guard
 * layout; a project using a different auth library should swap them wholesale
 * rather than appending.
 */
const GUARDS: readonly string[] = [
  // Session identity
  "auth()",
  "getServerSession(",
  "getCurrentUser(",
  // Role / ownership guards
  "requireUser(",
  "requireUserSelf(",
  "requireAdmin(",
  "requireAdminSession(",
  "requireAdminSection(",
  "requireOwner(",
  // Capability tokens — scoped to a purpose AND a resource id, so they
  // authorize a specific bearer for a specific object.
  "verifyAccessToken(",
  "verifySignature(",
];

/** Persistence calls. A module doing any of these is "writing". */
const WRITE_CALLS: readonly string[] = [
  ".create(",
  ".insertMany(",
  ".updateOne(",
  ".updateMany(",
  ".findOneAndUpdate(",
  ".findByIdAndUpdate(",
  ".findOneAndDelete(",
  ".findByIdAndDelete(",
  ".deleteOne(",
  ".deleteMany(",
  ".bulkWrite(",
  ".save(",
];

/**
 * Writing server actions with no caller to authorize, because they run BEFORE
 * anyone is signed in.
 *
 * This is the dangerous list to grow. Every entry means "reachable by anyone on
 * the internet", so each states why, and each should independently be
 * rate-limited and validate its own input.
 *
 * Starts empty on purpose: a fresh repo has no pre-auth actions, and the
 * staleness check below goes live the moment the first entry is added.
 */
const PRE_AUTH_ALLOWANCE: Readonly<Record<string, string>> = {};

/** Directories that may contain `"use server"` modules. */
const SCAN_DIRS: readonly string[] = ["src"];

/**
 * Anti-vacuity floor on the SOURCE WALK, not on the count of server actions.
 *
 * A repo may legitimately have zero actions on day 0, so flooring the action
 * count would either fail on a fresh install or have to be zero — and a zero
 * floor is the tautology `_kit-selfcheck` exists to catch. Flooring the walk
 * instead asserts the only thing that must be true: the scanner found source.
 */
const SCAN_FLOOR = 3;

/**
 * `"use server"` as the file's leading directive, ignoring comments.
 *
 * Deliberately not a substring search: the string also appears inside docblocks
 * on modules that explain why they are NOT server actions, and counting those
 * would flag the very files that got the decision right.
 */
function hasServerDirective(source: string): boolean {
  const withoutLeadingComments = source.replace(
    /^(\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*/,
    "",
  );
  const head = withoutLeadingComments.trimStart();
  return head.startsWith('"use server"') || head.startsWith("'use server'");
}

interface ServerModule {
  file: string;
  writes: boolean;
  guarded: boolean;
}

function scanned(): { files: string[]; modules: ServerModule[] } {
  const files = SCAN_DIRS.flatMap((dir) => walkFiles(dir, [".ts", ".tsx"]));

  const modules = files
    .filter((file) => !file.includes(".test."))
    .map((file) => ({ file, source: readSource(file) }))
    .filter(({ source }) => hasServerDirective(source))
    .map(({ file, source }) => ({
      file,
      writes: WRITE_CALLS.some((call) => source.includes(call)),
      guarded: GUARDS.some((guard) => source.includes(guard)),
    }));

  return { files, modules };
}

describe("convention: server actions that write must authorize", () => {
  const { files, modules } = scanned();

  it("scanned the source tree", () => {
    // Floor is on the SOURCE WALK, not on the count of server actions — a repo
    // may legitimately have zero actions on day 0, but a walk that returns
    // nothing means the scan is broken and every assertion below is vacuous.
    assertScanned(files, {
      name: "server-action-authorization",
      dir: SCAN_DIRS.join(", "),
      floor: SCAN_FLOOR,
    });
  });

  it("has no writing server action without a guard", () => {
    const unguarded = modules
      .filter((module) => module.writes && !module.guarded)
      .filter((module) => !(module.file in PRE_AUTH_ALLOWANCE))
      .map((module) => `  ${module.file}`);

    assert.deepEqual(
      unguarded,
      [],
      `A "use server" module writes without authorizing its caller.\n\n` +
        `A server action is a public endpoint. Its action id can be POSTed to from\n` +
        `anywhere, regardless of which page renders the button — so gating the page\n` +
        `does not gate the action.\n\n` +
        `Three fixes, in order of preference:\n` +
        `  1. If only server code calls it, DELETE the "use server" directive. It then\n` +
        `     stops being an endpoint at all. This is usually the right answer for a\n` +
        `     helper module that drifted into carrying the directive.\n` +
        `  2. Call a guard as the FIRST statement — before validation, so an\n` +
        `     unauthorized caller never reaches a query and schema errors leak nothing.\n` +
        `  3. If it is genuinely pre-auth, add it to PRE_AUTH_ALLOWANCE with a reason,\n` +
        `     and make sure it is rate-limited.\n\n` +
        `If it IS guarded and this test disagrees, your guard is missing from GUARDS.\n` +
        `Add it — but check first that it authorizes the caller rather than checking\n` +
        `whether a feature is switched on.\n\n` +
        `${unguarded.join("\n")}`,
    );
  });

  it("keeps PRE_AUTH_ALLOWANCE free of stale entries", () => {
    // An entry left behind after a file is deleted, renamed, or given a real
    // guard silently widens the hole this test exists to close.
    const byFile = new Map(modules.map((module) => [module.file, module]));
    const stale: string[] = [];

    for (const file of Object.keys(PRE_AUTH_ALLOWANCE)) {
      const found = byFile.get(file);
      if (!found) {
        stale.push(`  ${file}: no longer a "use server" module — remove the entry`);
      } else if (found.guarded) {
        stale.push(`  ${file}: now calls a guard — remove the entry so the rule covers it`);
      } else if (!found.writes) {
        stale.push(`  ${file}: no longer writes — remove the entry`);
      }
    }

    assert.deepEqual(stale, [], `PRE_AUTH_ALLOWANCE is out of date.\n${stale.join("\n")}`);
  });
});
