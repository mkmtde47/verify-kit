# verify-kit

Enforcement machinery for a new Next.js + TypeScript app, so day 1 has the
guardrails day 400 has.

## Why this exists

An audit of one app across 2,822 commits and 1,178 PRs found the problem was
never missing knowledge. There were 140 memory files, a 153KB agent document and
genuinely excellent docblocks. Nothing executed them.

- No ESLint config at all — while 62 `eslint-disable` comments accumulated over
  four months, 32 of them citing rules from plugins that were never installed.
- 341 test files that no CI job ran, so a PR could merge with a red suite.
- `ignoreBuildErrors: true` on the deploy path, bypassing the one remaining gate.

The same timezone hydration bug shipped **four times** with the correct fix
written down after each one. Two lookup maps that a docblock said "must agree"
drifted apart six times in four days. The fix-to-feature ratio went 35% → 70% in
a month.

**Prose does not enforce.** That is the whole thesis. This kit is the part that
executes.

## Install

```bash
npx create-next-app@latest my-app --ts --tailwind --src-dir --app --import-alias "@/*"
cd my-app
npx degit mkmtde47/verify-kit .verify-kit && node .verify-kit/install.mjs
npm i -D tsx typescript @types/node eslint typescript-eslint
npm run verify
```

`--src-dir` and `--import-alias "@/*"` are load-bearing, not taste: the scanners
walk `src`, and tsx resolves the alias so convention tests can import app
modules. The installer refuses to run without them and says why.

**Then break something.** The installer prints this and it is not decoration — a
gate nobody has watched fire is indistinguishable from one that cannot fire:

```bash
echo 'export const d = new Date().toLocaleDateString();' > src/lib/probe.ts
npm run verify        # expect RED, naming the hydration mismatch
rm src/lib/probe.ts
```

Record what you broke, and that it went red, in your first commit body.

## The gate

```
npm run verify  →  typecheck → lint → test:harness
```

Run locally before every push. **This is the authoritative gate.** CI
(`.github/workflows/verify.yml`) runs the same steps as a second net, never as
the safety net — Actions billing can lapse and jobs then never start, silently.

`test:harness` runs the suite and then asserts on the result, so `verify` does
not also chain `test:unit` — that would run every test twice. `test:unit`
remains for running the suite directly during development.

## What it installs

Two tiers, and the difference is the point.

| Tier | Meaning |
|---|---|
| `core/` | Byte-identical across every app, hash-pinned in `guardrails.kit.json`. Drift is a bug and the self-check fails on it. |
| `seeds/` | Copied once, then **yours**. Budgets are per-repo; drift here is expected. Never clobbered on re-install. |

To fork a `core/` file deliberately, add its path to `owned` in
`guardrails.kit.json` with a written reason, so `install.mjs` cannot silently
clobber it.

### Active on day 0

| Guard | Enforces |
|---|---|
| `tests/unit/conventions/_kit-selfcheck.test.ts` | The kit's own claims, and the docs' claims |
| `tests/unit/conventions/file-size-budget.test.ts` | No file over 800 lines |
| `tests/unit/conventions/timezone-budget.test.ts` | Every date format pins a `timeZone` |
| `scripts/verify-harness.mjs` | The suite actually ran |
| `eslint.config.mjs` | Unpinned dates, swallowed errors, stray console/debugger |

### Dormant, with executable wake conditions

Listed in `tests/unit/conventions/_dormant.ts`. The self-check **fails the build**
the moment one comes true, so a rule that does not apply yet is a scheduled
alarm rather than an invisible hole.

`mdx-no-html-comments` · `dbconnect-coverage` · `ai-durable-limit` ·
`job-registration-parity`

Run `node .verify-kit/install.mjs --report` for the live table.

## Three design decisions worth knowing

**1. The runner exits 0 on zero tests.** Measured, not assumed:

```
$ npx tsx --test "tests/unit/does-not-exist/**/*.test.ts"
# tests 0    # fail 0    exit code: 0
```

So a fresh repo's `verify` is green having executed nothing — the audit's disease
reproducing itself in the harness, during the exact window where habits form. A
test cannot assert that tests ran, so `scripts/verify-harness.mjs` lives outside
`node:test` and checks the file count, the TAP trailer, and whether the glob in
`package.json` is quoted. (An unquoted `**` is expanded by `sh`, which has no
globstar; that silently ran 44 of 725 tests in the source app while printing
green.)

**2. Bans on day 0, ratchets on retrofit.** "Ratchet, don't ban" is a *retrofit*
rule — it exists because a flat ban against 33 existing violations fails on day
one and gets deleted, after which it enforces nothing. A new repo has no
inherited debt, so budgets are 0 and rules are absolutes.

The trap is the companion "keep the budget honest" assertion. At `BUDGET 0` with
`SLACK 3` it reads `found.length >= -3` — no input could ever fail it, while
rendering as a live green test. The seeds omit it, and the self-check fails the
build if anyone adds it back at budget 0. Run `install.mjs --baseline` when
dropping the kit into an existing repo; it measures the repo and writes real
budgets.

**3. The anti-vacuity floor is itself a ratchet.** Every scanning test must prove
it scanned something — a walker returning `[]` passes every assertion below it
and looks identical to health. The source app hardcoded `files.length > 500`,
measured once against 1,536 files. That is red on day 0 and `> 0` is dead the
moment a second file exists, so `assertScanned` nags the floor *upward* as the
repo grows, with compound slack: `max(floor × 2, floor + 25)`. Proportional slack
alone nags at 7 files when the floor is 3; absolute slack alone is a no-op at
1,500 files.

## Adding a rule

Bring the incident — the commit, the symptom, the cost. Not "this seems risky."

The seed ESLint config adopts no recommended set, deliberately: a config that
shouts on day one gets disabled within a week, and a disabled linter enforces
nothing. On transplant the bar is *a real incident, not a real incident in this
repo* — otherwise a new app must re-earn a bug that already cost four incidents
elsewhere. Stack-level inevitable causes ship active; app-specific ones ship
commented out with the incident attached, as a worked example.

Then prove it fails before you trust it.

## What this cannot do

The self-check verifies **existence**, never **truth**. In the source app a
convention test opened with "bufferCommands is off, so a model call throws" long
after `mongoose.ts` had flipped it to `true`. Every symbol that docblock named
still existed; only the world had changed.

Semantic rot is not machine-checkable. Claiming otherwise would itself be the rot
pattern.

## Deliberately not included

- **`ignoreBuildErrors: true`** — a scar with a documented cause in a 1,536-file
  repo, and the exact "nothing executes on the deploy path" hole the audit found.
- **An orphan-guard workflow** — by its own header it "has run 31 times and
  detected nothing", because every real orphan was pushed 15–27 minutes after
  merge and a push to a merged branch re-triggers nothing. A green check that
  means nothing is the thesis inverted.
- **A starter repo** — enforcement doctrine does not decay; a dependency snapshot
  decays in weeks. Use `create-next-app`, which Vercel keeps current for free.
- **Every measured number** — budgets and baselines are measurements of one repo
  at one commit. The kit ships the shape; `--baseline` measures yours.
