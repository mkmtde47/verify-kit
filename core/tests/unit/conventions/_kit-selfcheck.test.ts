/**
 * The kit checking itself.
 *
 * WHY THIS FILE EXISTS
 *
 * Every rot pattern below was found live in the system this kit was extracted
 * from. None is hypothetical:
 *
 *   - A rules README documenting three directories and an installer that do
 *     not exist.
 *   - A kill-switch doc instructing you to disable hooks by editing
 *     `~/.claude/hooks.json` — a file that has never existed, so the documented
 *     escape hatch for a misbehaving hook was a no-op.
 *   - A project constitution mandating an `actionHandler` wrapper that had
 *     never existed in the codebase. Six files ended up carrying docblocks
 *     explaining why they could not comply, instead of anyone correcting the
 *     rule. An instruction file is never executed, so a rule naming a
 *     non-existent symbol fails silently forever — and trains everyone to read
 *     the whole document as advisory.
 *   - A `next.config.ts` comment asserting "no ESLint config exists in this
 *     repo regardless", sitting beside a 283-line ESLint config added days
 *     later.
 *
 * The common shape: a document made a checkable claim, the claim went false,
 * and nothing checked. This file checks.
 *
 * WHAT IT CANNOT DO, stated plainly rather than papered over: it verifies
 * EXISTENCE, never TRUTH. In the source app, `dbconnect-coverage.test.ts`
 * opened with "bufferCommands is off, so a model call throws" — and
 * `src/lib/mongoose.ts` had since flipped it to `true`. Every symbol that
 * docblock named still existed. Only the world had changed. Semantic rot is not
 * machine-checkable, and claiming otherwise would itself be the rot pattern.
 *
 * PART OF `core/` — do not edit in a consuming repo.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import { REPO_ROOT, walkFiles, readSource } from "./source-scan";
import { DORMANT } from "./_dormant";

/** Docs whose claims this file holds to account. */
const GOVERNED_DOCS = ["CLAUDE.md", "VERIFY-KIT.md"] as const;

/**
 * Path-shaped tokens that are prose, illustration, or deliberately generic.
 * Allowlist-with-reason: every entry states why it cannot resolve, and the
 * staleness test below deletes it once it can.
 */
const UNRESOLVABLE: Readonly<Record<string, string>> = {
  "package.json": "Referenced generically; always present, checked by npm itself.",
};

const pathish = /`([a-zA-Z0-9_@./-]+\.(?:ts|tsx|mjs|cjs|js|json|md|mdx|yml|yaml|css))`/g;
const npmScript = /`npm run ([a-zA-Z0-9:_-]+)`/g;

function docsPresent(): string[] {
  return GOVERNED_DOCS.filter((d) => existsSync(path.join(REPO_ROOT, d)));
}

describe("verify-kit self-check", () => {
  it("is itself discovered by the test glob", () => {
    // The one assertion this file cannot make wrongly. Paired with the
    // file-count check in scripts/verify-harness.mjs, each lock covers the
    // other's blind spot: the harness proves tests ran, this proves the
    // self-check is one of them.
    const found = walkFiles("tests/unit", [".test.ts"]);
    assert.ok(
      found.some((f) => f.endsWith("_kit-selfcheck.test.ts")),
      `_kit-selfcheck.test.ts is not inside the tests/unit glob. It is not running.\n` +
        `Found ${found.length} test files: ${found.slice(0, 5).join(", ")}`,
    );
  });

  it("every file path named in a governed doc exists", () => {
    const missing: string[] = [];

    for (const doc of docsPresent()) {
      const source = readSource(doc);
      for (const [, token] of source.matchAll(pathish)) {
        if (token in UNRESOLVABLE) continue;

        // An `@docs/x.md` reference is ambiguous: it may mean an import alias
        // (docs/x.md) or a literal directory named "@docs". Accept either —
        // failing only when NEITHER exists. That exact ambiguity broke the
        // source app's CLAUDE.md, where both readings were wrong.
        const candidates = token.startsWith("@")
          ? [token, token.slice(1)]
          : [token];

        if (!candidates.some((c) => existsSync(path.join(REPO_ROOT, c)))) {
          missing.push(`  ${doc} names \`${token}\` — no such file`);
        }
      }
    }

    assert.deepEqual(
      missing,
      [],
      `A governed document names files that do not exist:\n${missing.join("\n")}\n\n` +
        `Why this matters: an instruction file is never executed, so a rule naming a\n` +
        `missing symbol fails silently forever and trains readers to ignore the document.\n` +
        `Fix the DOC, not the reader. If the path is prose, add it to UNRESOLVABLE with a reason.`,
    );
  });

  it("every npm script a governed doc tells you to run exists", () => {
    if (!existsSync(path.join(REPO_ROOT, "package.json"))) return;
    const scripts = JSON.parse(readSource("package.json")).scripts ?? {};
    const missing: string[] = [];

    for (const doc of docsPresent()) {
      for (const [, name] of readSource(doc).matchAll(npmScript)) {
        if (!(name in scripts)) missing.push(`  ${doc} says to run \`npm run ${name}\` — no such script`);
      }
    }

    assert.deepEqual(
      missing,
      [],
      `A governed document tells you to run a command that does not exist:\n${missing.join("\n")}\n\n` +
        `This is the kill-switch failure: the documented escape hatch was a no-op for months.`,
    );
  });

  it("no dormant guard's wake condition has come true", () => {
    const woken = DORMANT.filter((g) => {
      try {
        return g.wakes();
      } catch {
        return false;
      }
    });

    assert.deepEqual(
      woken.map((g) => g.id),
      [],
      `A dormant guard now applies to this repo:\n` +
        woken.map((g) => `  ${g.id}\n    was asleep because: ${g.reason}\n    activate: ${g.activate}`).join("\n") +
        `\n\nThis is not a bug in your change — it is the alarm working. Activate the guard\n` +
        `and remove its entry from _dormant.ts.`,
    );
  });

  it("no ratchet is tautological", () => {
    // A budget of 0 is CORRECT in a fresh repo — a ban, affordable exactly
    // because there is no inherited debt. The trap is the companion "keep the
    // budget honest" assertion, which reads `found.length >= BUDGET - SLACK`.
    // At BUDGET 0 / SLACK 3 that asserts `>= -3`: no input could ever fail it,
    // yet it renders as a live green test.
    //
    // Contrast a staleness check over an EMPTY allowlist (`deepEqual(stale, [])`).
    // That is vacuous-but-correct — a real assertion over an empty domain that
    // goes live the instant the first entry is added. Keep those.
    const offenders: string[] = [];

    for (const file of walkFiles("tests/unit/conventions", [".test.ts"])) {
      const source = readSource(file);
      const zeroBudget = /const\s+([A-Z_]*BUDGET)\s*=\s*0\s*[;\n]/.exec(source);
      if (zeroBudget && /honest|>=\s*[A-Z_]*BUDGET\s*-/.test(source)) {
        offenders.push(
          `  ${file}: ${zeroBudget[1]} is 0 but the file still carries a "keep it honest" assertion`,
        );
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `Tautological ratchet found:\n${offenders.join("\n")}\n\n` +
        `A zero budget is a ban and needs no lower bound. Delete the honesty half until\n` +
        `install.mjs --baseline measures a nonzero budget for this repo.`,
    );
  });

  it("every scanning test carries an anti-vacuity sentinel", () => {
    // A test that calls walkFiles without assertScanned passes when the walker
    // returns nothing. Pure tests (no disk scan) legitimately need neither.
    const offenders: string[] = [];

    for (const file of walkFiles("tests/unit/conventions", [".test.ts"])) {
      const source = readSource(file);
      if (source.includes("walkFiles(") && !source.includes("assertScanned(")) {
        offenders.push(`  ${file}`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `Scanning test with no anti-vacuity sentinel:\n${offenders.join("\n")}\n\n` +
        `Call assertScanned(files, { name, dir, floor }) before asserting anything about\n` +
        `what the scan found. Otherwise a renamed directory turns the test green forever.`,
    );
  });

  it("CI runs at least what `npm run verify` runs", () => {
    const workflow = ".github/workflows/verify.yml";
    if (!existsSync(path.join(REPO_ROOT, workflow))) return;
    if (!existsSync(path.join(REPO_ROOT, "package.json"))) return;

    const scripts = JSON.parse(readSource("package.json")).scripts ?? {};
    const ciText = readSource(workflow);

    // Compare the SET of steps, not the sequence. The source app ran
    // tsc→lint→test locally and tsc→test→lint in CI; that difference is
    // harmless. A step present locally and absent in CI is not.
    //
    // Match either spelling. The workflow deliberately calls the underlying
    // binaries (`npx tsc --noEmit`) rather than `npm run typecheck`, so that it
    // works whether or not the script exists in package.json — so comparing
    // only on `npm run X` would report every step as missing.
    const steps: string[] = (scripts.verify ?? "")
      .split("&&")
      .map((s: string) => s.trim().replace(/^npm run /, ""))
      .filter(Boolean);

    const missing = steps.filter((step) => {
      if (ciText.includes(`npm run ${step}`)) return false;
      const body: string = scripts[step] ?? "";
      // `eslint .` must match `npx eslint . --max-warnings 0`; compare on the
      // command and its first argument, which is enough to identify the step.
      const signature = body.split(/\s+/).slice(0, 2).join(" ");
      return signature.length > 0 ? !ciText.includes(signature) : true;
    });

    assert.deepEqual(
      missing,
      [],
      `CI does not run every step that \`npm run verify\` runs. Missing: ${missing.join(", ")}\n\n` +
        `This is the original disease as a standing assertion: the source app had 341 test\n` +
        `files and no CI job that ran them, so a PR could merge with a red suite.`,
    );
  });

  it("keeps the UNRESOLVABLE allowlist free of stale entries", () => {
    const stale = Object.keys(UNRESOLVABLE).filter(
      (p) => p !== "package.json" && !existsSync(path.join(REPO_ROOT, p)),
    );
    // Entries are for paths that CANNOT resolve. One that now resolves should
    // be removed so the real check covers it again.
    const resolvable = Object.keys(UNRESOLVABLE).filter(
      (p) => p !== "package.json" && existsSync(path.join(REPO_ROOT, p)),
    );
    assert.deepEqual(
      resolvable,
      [],
      `These paths are on the UNRESOLVABLE allowlist but now exist: ${resolvable.join(", ")}\n` +
        `Remove them so the existence check covers them again.`,
    );
    void stale;
  });

  it("core/ files are unmodified", () => {
    const manifestPath = path.join(REPO_ROOT, "guardrails.kit.json");
    if (!existsSync(manifestPath)) return; // Kit not installed via install.mjs.

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const owned: string[] = manifest.owned ?? [];
    const drifted: string[] = [];

    for (const [file, expected] of Object.entries(manifest.core ?? {})) {
      if (owned.includes(file)) continue;
      const abs = path.join(REPO_ROOT, file);
      if (!existsSync(abs)) {
        drifted.push(`  ${file} — missing`);
        continue;
      }
      const actual = createHash("sha256").update(readFileSync(abs)).digest("hex").slice(0, 16);
      if (actual !== expected) drifted.push(`  ${file} — modified`);
    }

    assert.deepEqual(
      drifted,
      [],
      `core/ files have drifted from the kit:\n${drifted.join("\n")}\n\n` +
        `Drift in core/ is a bug; drift in seeds/ is the point. If this change is deliberate,\n` +
        `add the path to "owned" in guardrails.kit.json with a written reason, so a future\n` +
        `\`install.mjs --update\` cannot silently clobber it.`,
    );
  });
});
