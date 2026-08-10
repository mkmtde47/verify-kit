/**
 * Shared source-walking helpers for the convention tests.
 *
 * Not a `.test.ts` file, so the `tests/unit/**\/*.test.ts` glob skips it.
 *
 * WHY CONVENTION TESTS EXIST
 *
 * Rules that live only in prose — CLAUDE.md, docblocks, a README — do not fail
 * a build. An audit of one app across 2,822 commits found the problem was never
 * missing knowledge: there were 140 memory files, a 153KB agent doc and
 * excellent docblocks. Nothing executed them. The same timezone hydration bug
 * shipped four times while the fix was written down each time, and a docblock
 * saying two lookup maps "must agree" did not stop them drifting apart six
 * times in four days.
 *
 * These tests are the layer that executes. They read source off disk and assert
 * a repo-wide invariant holds.
 *
 * PART OF `core/` — do not edit in a consuming repo.
 * `_kit-selfcheck.test.ts` hashes this file. If you genuinely need a local
 * change, declare it in `guardrails.kit.json` under `owned` with a reason, so
 * `install.mjs --update` cannot silently clobber it.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";

/** Repo root. Tests run from the package root. */
export const REPO_ROOT = process.cwd();

const IGNORED_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
  ".vercel",
  ".verify-kit",
]);

/**
 * Every file under `dir` whose extension is in `extensions`, as repo-relative
 * POSIX paths, sorted for stable assertion output.
 *
 * NOTE the silent `return` on an unreadable directory. That is deliberate — a
 * convention test should not explode in a checkout where an optional subsystem
 * is absent — but it is also exactly how a scanning test becomes vacuous. A
 * walker that returns `[]` passes every downstream assertion and looks
 * identical to a healthy one. Never call this without `assertScanned`.
 */
export function walkFiles(dir: string, extensions: readonly string[]): string[] {
  const absoluteRoot = path.join(REPO_ROOT, dir);
  const out: string[] = [];

  const visit = (absolute: string) => {
    let entries: string[];
    try {
      entries = readdirSync(absolute);
    } catch {
      return; // Directory absent in this checkout — nothing to enforce.
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry)) continue;
      const child = path.join(absolute, entry);
      if (statSync(child).isDirectory()) {
        visit(child);
        continue;
      }
      if (extensions.some((ext) => entry.endsWith(ext))) {
        out.push(path.relative(REPO_ROOT, child).split(path.sep).join("/"));
      }
    }
  };

  visit(absoluteRoot);
  return out.sort();
}

/** Read a repo-relative path. */
export function readSource(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

/**
 * The anti-vacuity sentinel, and the reason it is a helper rather than a line
 * you write by hand in each test.
 *
 * Every scanning test must prove it scanned something before asserting anything
 * about what it found. In the app this kit came from that was four hand-copied
 * magic numbers (`> 500`, `> 50`, `> 0`) across seven call sites, each measured
 * once against a 1,536-file repo and never revisited.
 *
 * A hardcoded floor cannot survive transplant: `> 500` is red on day 0 of a new
 * app, and `> 0` is dead the moment a second file exists. So the floor is
 * itself a ratchet — it starts small and is nagged upward as the repo grows.
 *
 * THE SLACK FORMULA is the load-bearing decision. It is compound on purpose:
 *
 *   nag when  files.length > max(floor * 2, floor + 25)
 *
 * Proportional slack alone (`floor * 2`) nags at 7 files when the floor is 3 —
 * inside the first hour of a new repo, and a guard that cries wolf gets
 * deleted, after which it enforces nothing. Absolute slack alone (`+ 25`, the
 * idiom used by the file-size ratchet) is a no-op at 1,500 files. The max of
 * the two degrades correctly at both ends: 3 → 28, 100 → 200, 500 → 1000.
 *
 * The floor's only job is to catch a walker returning `[]` or a directory that
 * was renamed out from under the test. It is allowed to lag badly. It must not
 * lag so badly that it stops noticing a partial breakage.
 */
export function assertScanned(
  files: readonly string[],
  options: { name: string; dir: string; floor: number },
): void {
  const { name, dir, floor } = options;

  assert.ok(
    files.length >= floor,
    `[${name}] scanned ${files.length} files under "${dir}", expected at least ${floor}.\n` +
      `Why this matters: a scan that finds nothing passes every assertion below it while\n` +
      `enforcing nothing, and looks identical to a healthy run.\n` +
      `Likely causes: the directory was renamed or moved; the extension list is wrong;\n` +
      `you are running from somewhere other than the repo root.`,
  );

  const nagAt = Math.max(floor * 2, floor + 25);
  assert.ok(
    files.length <= nagAt,
    `[${name}] scanned ${files.length} files under "${dir}" against a floor of ${floor}.\n` +
      `The repo has outgrown the floor — raise it to ${files.length} to bank the coverage.\n` +
      `This is not a failure in your change. It is the sentinel keeping itself meaningful:\n` +
      `a floor of ${floor} would no longer notice if the walker broke and returned ${floor} files.`,
  );
}

/**
 * The source text of the argument list of the call that starts at `openParen`,
 * tracking nesting so a nested call or object literal does not end it early.
 *
 * Deliberately naive about strings containing parentheses — a false "balanced"
 * reading would only ever widen the span searched, and a widened span cannot
 * produce a false FAILURE, only a missed one. Erring toward silence beats
 * erring toward a test nobody trusts.
 */
export function callArguments(source: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return source.slice(openParen + 1, i);
    }
  }
  return source.slice(openParen + 1);
}

export interface CallSite {
  file: string;
  line: number;
  snippet: string;
}

/**
 * Every call to one of `patterns` in `files` whose arguments do NOT mention
 * `argument`.
 *
 * `patterns` are matched as literal text immediately followed by `(`, e.g.
 * `.toLocaleDateString`.
 */
export function findCallsMissingArgument(
  files: readonly string[],
  patterns: readonly string[],
  argument: string,
): CallSite[] {
  const hits: CallSite[] = [];

  for (const file of files) {
    const source = readSource(file);
    for (const pattern of patterns) {
      let from = 0;
      for (;;) {
        const at = source.indexOf(pattern, from);
        if (at === -1) break;
        from = at + pattern.length;

        // Require the call form: the next non-space character must be "(".
        const rest = source.slice(at + pattern.length);
        const openOffset = rest.search(/\S/);
        if (openOffset === -1 || rest[openOffset] !== "(") continue;

        const openParen = at + pattern.length + openOffset;
        if (callArguments(source, openParen).includes(argument)) continue;

        const line = source.slice(0, at).split("\n").length;
        hits.push({
          file,
          line,
          snippet: source.split("\n")[line - 1]?.trim().slice(0, 120) ?? "",
        });
      }
    }
  }

  return hits;
}

/** `file:line` list, one per line — readable assertion output. */
export function formatSites(sites: readonly CallSite[]): string {
  return sites.map((s) => `  ${s.file}:${s.line}  ${s.snippet}`).join("\n");
}
