#!/usr/bin/env node
/**
 * verify-kit installer. Idempotent — safe to re-run.
 *
 *   node .verify-kit/install.mjs             install or update
 *   node .verify-kit/install.mjs --baseline  measure THIS repo, write budgets (retrofit)
 *   node .verify-kit/install.mjs --report    print the live status table
 *
 * TWO TIERS, AND THE DIFFERENCE MATTERS
 *
 *   core/   byte-identical across every app. Hash-pinned in guardrails.kit.json.
 *           Drift here is a bug and _kit-selfcheck fails on it.
 *   seeds/  copied once, then OWNED by your repo. Existence-checked only.
 *           Drift here is the entire point — budgets are per-repo.
 *
 * That split is what stops "copied once, diverged forever", which is the
 * failure mode of every copy-a-directory approach.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.cwd();
const mode = process.argv[2] ?? "";

const say = (m) => console.log(m);
const die = (m) => { console.error(`\n[verify-kit] ${m}\n`); process.exit(1); };

// ---------------------------------------------------------------------------
// Preconditions. Both are load-bearing, not taste.
// ---------------------------------------------------------------------------
if (!existsSync(path.join(REPO, "package.json"))) {
  die("No package.json here. Run this from your project root.");
}
if (KIT_ROOT === REPO) {
  die("Run this from the CONSUMING repo, not from inside verify-kit itself.");
}

const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));

if (mode !== "--report") {
  if (!existsSync(path.join(REPO, "src"))) {
    die(
      "No src/ directory found.\n" +
        "The convention tests scan `src`, and tsx resolves the `@/*` alias from tsconfig.\n" +
        "Scaffold with:  npx create-next-app@latest --ts --src-dir --app --import-alias \"@/*\"\n" +
        "If your layout genuinely differs, edit SCANNED_DIR in the seed tests after installing.",
    );
  }
  const tsconfigPath = path.join(REPO, "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    const raw = readFileSync(tsconfigPath, "utf8");
    if (!raw.includes('"@/*"')) {
      say('[verify-kit] WARNING: tsconfig has no "@/*" path alias. Tests importing app modules will fail to resolve.');
    }
  }
  // The convention tests import node builtins, so tsc needs @types/node.
  // create-next-app ships it; a bare repo does not, and the failure is 14
  // confusing TS2591 errors pointing at the kit's own files.
  if (!existsSync(path.join(REPO, "node_modules/@types/node"))) {
    say("[verify-kit] WARNING: @types/node is not installed. `npm run typecheck` will fail on the");
    say("             convention tests until you add it:  npm i -D @types/node");
  }
}

// ---------------------------------------------------------------------------
function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...walk(abs, base));
    else out.push(path.relative(base, abs).split(path.sep).join("/"));
  }
  return out;
}

const shortHash = (abs) =>
  createHash("sha256").update(readFileSync(abs)).digest("hex").slice(0, 16);

// ---------------------------------------------------------------------------
// --report
// ---------------------------------------------------------------------------
if (mode === "--report") {
  const conventions = path.join(REPO, "tests/unit/conventions");
  if (!existsSync(conventions)) die("Kit not installed here — no tests/unit/conventions.");

  say("\n| Guard | Status |");
  say("|---|---|");
  for (const f of readdirSync(conventions).filter((f) => f.endsWith(".test.ts")).sort()) {
    say(`| \`${f.replace(".test.ts", "")}\` | active |`);
  }
  const dormantFile = path.join(conventions, "_dormant.ts");
  if (existsSync(dormantFile)) {
    for (const [, id, reason] of readFileSync(dormantFile, "utf8")
      .matchAll(/id:\s*"([^"]+)",\s*\n\s*reason:\s*\n?\s*"([^"]+)/g)) {
      say(`| \`${id}\` | dormant — ${reason} |`);
    }
  }
  say("");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------
say("[verify-kit] installing…");

const manifest = { version: 1, core: {}, seeds: [], owned: [] };
const existingManifestPath = path.join(REPO, "guardrails.kit.json");
if (existsSync(existingManifestPath)) {
  const prev = JSON.parse(readFileSync(existingManifestPath, "utf8"));
  manifest.owned = prev.owned ?? [];
}

// core/ — always overwritten unless declared `owned`.
for (const rel of walk(path.join(KIT_ROOT, "core"))) {
  const dest = path.join(REPO, rel);
  if (manifest.owned.includes(rel)) {
    say(`  skip (owned)  ${rel}`);
    manifest.core[rel] = shortHash(dest);
    continue;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(path.join(KIT_ROOT, "core", rel), dest);
  manifest.core[rel] = shortHash(dest);
  say(`  core          ${rel}`);
}

// seeds/ — copied ONLY if absent. Never clobber a repo's own budgets.
for (const rel of walk(path.join(KIT_ROOT, "seeds"))) {
  const dest = path.join(REPO, rel.replace(/^CLAUDE\.md\.fragment$/, "VERIFY-KIT.md"));
  manifest.seeds.push(path.relative(REPO, dest).split(path.sep).join("/"));
  if (existsSync(dest)) {
    say(`  keep (yours)  ${rel}`);
    continue;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(path.join(KIT_ROOT, "seeds", rel), dest);
  say(`  seed          ${rel}`);
}

// package.json scripts — additive; never clobber an existing definition.
const WANT = {
  typecheck: "tsc --noEmit",
  // `--max-warnings 0` is not optional. Plain `eslint .` EXITS 0 on warnings,
  // and most rules in the seed config are warn-level by design (so they can be
  // baselined per-path during a retrofit). Without this flag the local gate —
  // the authoritative one — silently ignores every one of them, while CI, which
  // does pass the flag, fails. Measured: `eslint .` → 0, `eslint . --max-warnings 0` → 1.
  lint: "eslint . --max-warnings 0",
  "test:harness": "node scripts/verify-harness.mjs",
  // Kept for running the suite directly during development. NOT part of
  // `verify` — test:harness already spawns the whole suite and then asserts on
  // the TAP trailer, so chaining both would run every test twice.
  "test:unit": 'tsx --test "tests/unit/**/*.test.ts"',
  verify: "npm run typecheck && npm run lint && npm run test:harness",
};
pkg.scripts ??= {};
const added = [];
for (const [name, body] of Object.entries(WANT)) {
  if (!pkg.scripts[name]) { pkg.scripts[name] = body; added.push(name); }
}
writeFileSync(path.join(REPO, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
writeFileSync(existingManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

say(`  scripts       ${added.length ? added.join(", ") : "(all already present)"}`);

// ---------------------------------------------------------------------------
// --baseline: measure THIS repo. The retrofit path.
// ---------------------------------------------------------------------------
if (mode === "--baseline") {
  say("\n[verify-kit] measuring existing violations…");
  const srcFiles = [];
  const visit = (d) => {
    for (const e of readdirSync(d)) {
      if (["node_modules", ".next", ".git"].includes(e)) continue;
      const abs = path.join(d, e);
      if (statSync(abs).isDirectory()) visit(abs);
      else if (/\.tsx?$/.test(e)) srcFiles.push(abs);
    }
  };
  visit(path.join(REPO, "src"));

  const oversize = srcFiles
    .map((f) => [path.relative(REPO, f).split(path.sep).join("/"), readFileSync(f, "utf8").split("\n").length])
    .filter(([, n]) => n > 800)
    .sort((a, b) => b[1] - a[1]);

  say(`  ${srcFiles.length} source files, ${oversize.length} over the 800-line cap.`);
  if (oversize.length) {
    say("\n  Paste into OVERSIZE_ALLOWANCE in tests/unit/conventions/file-size-budget.test.ts:\n");
    for (const [f, n] of oversize) say(`    "${f}": ${n},`);
    say("\n  Then restore the honesty half of each ratchet — see the seed docblocks.");
  }
}

// ---------------------------------------------------------------------------
// Fire the gate before trusting it.
// ---------------------------------------------------------------------------
say(`
[verify-kit] installed.

NEXT — and do not skip this. A gate nobody has watched fire is
indistinguishable from one that cannot fire.

  1. npm i -D tsx typescript @types/node eslint typescript-eslint
     (@types/node is not optional — every convention test imports node builtins.
      create-next-app already includes it; a bare npm-init repo does not.)
  2. npm run verify                       → expect GREEN
  3. Add this line to any file under src/, then run verify again:
         const d = new Date().toLocaleDateString();
     → expect RED, naming the hydration mismatch. Then delete it.
  4. Record what you broke, and that it went red, in your first commit body.

Retrofitting an existing repo? Re-run with --baseline.`);

void spawnSync;
