/**
 * Every background job must actually be REGISTERED.
 *
 * WHAT HAPPENED
 *
 * A job factory call — `inngest.createFunction`, a queue `.process()`, a cron
 * registration — sitting in a file nobody imports produces a job that
 * type-checks, lints, passes every unit test, and never runs. There is no error
 * anywhere. The cron simply does not exist, and the only symptom is silence
 * from a feature that was supposed to be periodic.
 *
 * That is the same shape as a hook wired into the wrong config file: months of
 * edits to code that was never executed. It is invisible precisely because
 * every signal a developer normally trusts stays green.
 *
 * The `serve()` call is a single registration point, and adding a function to
 * it is a manual second step that nothing else in the codebase forces. Nothing
 * references the export otherwise.
 *
 * BOTH DIRECTIONS, BECAUSE THEY CATCH DIFFERENT MISTAKES
 *
 *   - defined but not registered  → a dead cron, silent forever
 *   - registered but no longer defined → a rename that fails at runtime on the
 *     next deploy rather than here
 *
 * Plus a third: two jobs sharing an id silently collapse into one on the
 * provider's side. The second registration overwrites the first and one cron
 * stops firing, again with no error.
 *
 * WHY THE EXPORT PATTERN IS BROAD
 *
 * Matching `export const X = inngest.createFunction` is the obvious first
 * attempt and it is wrong. A codebase that builds jobs through a factory
 * (`makeReminder("24h")`) has real jobs that never syntactically contain the
 * creator call, so that pattern reports them as ghosts — and worse, would MISS
 * a factory-built job that was never registered, which is the exact bug this
 * file exists to catch. Match any top-level `export const` in a file that
 * mentions the creator anywhere, then drop SCREAMING_CASE names as constants.
 *
 * ACTIVATION
 *
 * Copy into `tests/unit/conventions/` and delete the `job-registration-parity`
 * entry from `_dormant.ts`. Point `FUNCTIONS_DIR`, `ROUTE` and `CREATOR_CALL`
 * at your own job layer.
 *
 * On first activation `assertScanned` will fail with "the repo has outgrown the
 * floor — raise it to N". That is expected, not a bug: a dormant guard wakes
 * mid-life, so the day-0 floor below is always stale by then. Set SCAN_FLOOR to
 * the number the message names. The floor is a two-sided ratchet — it proves the
 * walker is alive AND stays meaningful as the repo grows.
 *
 * Run: npx tsx --test tests/unit/conventions/job-registration-parity.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assertScanned, readSource, walkFiles } from "./source-scan";

/** Where job definitions live. */
const FUNCTIONS_DIR = "src/lib/inngest/functions";

/** The single file holding the `serve()` registration array. */
const ROUTE = "src/app/api/inngest/route.ts";

/** Text identifying a file as building jobs. */
const CREATOR_CALL = "inngest.createFunction";

/** The array whose contents are the registrations. */
const REGISTRATION_ARRAY = /functions:\s*\[([\s\S]*?)\]/;

const SCAN_FLOOR = 1;

/** Top-level `export const NAME =`. SCREAMING_CASE is filtered out below. */
const EXPORT_PATTERN = /^export\s+const\s+([A-Za-z0-9_$]+)\s*=/gm;

const functionFiles = walkFiles(FUNCTIONS_DIR, [".ts"]).filter((f) => !f.includes(".test."));

/** Every exported job, as `{ name, file }`. */
const declared = functionFiles.flatMap((file) => {
  const source = readSource(file);
  if (!source.includes(CREATOR_CALL)) return [];
  return [...source.matchAll(EXPORT_PATTERN)]
    .map((match) => match[1])
    .filter((name) => name !== name.toUpperCase())
    .map((name) => ({ name, file }));
});

/**
 * The contents of the registration array — PARSED, not searched for bare names.
 * A lingering import of a job dropped from the array would otherwise make this
 * pass while the job is dead.
 */
const registered = (() => {
  let source: string;
  try {
    source = readSource(ROUTE);
  } catch {
    return new Set<string>();
  }
  const block = source.match(REGISTRATION_ARRAY)?.[1] ?? "";
  return new Set(
    block
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => /^[A-Za-z0-9_$]+$/.test(entry)),
  );
})();

describe("convention: background jobs are registered", () => {
  it("found the job surface and the registration array", () => {
    assertScanned(functionFiles, {
      name: "job-registration-parity",
      dir: FUNCTIONS_DIR,
      floor: SCAN_FLOOR,
    });

    // Separate from the file walk: the walk can succeed while the route is
    // renamed, and an empty registration set would then pass both directions
    // vacuously.
    assert.ok(
      registered.size > 0,
      `[job-registration-parity] parsed 0 entries from the registration array in ` +
        `"${ROUTE}".\nEither the file moved or REGISTRATION_ARRAY no longer matches its ` +
        `shape. Every assertion below is vacuous until this is fixed.`,
    );
  });

  it("registers every job that exists", () => {
    const orphans = declared
      .filter(({ name }) => !registered.has(name))
      .map(({ name, file }) => `  ${name}  (${file})`);

    assert.deepEqual(
      orphans,
      [],
      `Job(s) defined but never registered in ${ROUTE}.\n\n` +
        `An unregistered job type-checks, lints and tests clean — and never runs.\n` +
        `There is no error and no log line; the feature is just silently absent.\n\n` +
        `Import it and add it to the registration array.\n\n${orphans.join("\n")}`,
    );
  });

  it("registers nothing that no longer exists", () => {
    const names = new Set(declared.map((job) => job.name));
    const ghosts = [...registered].filter((name) => !names.has(name));

    assert.deepEqual(
      ghosts,
      [],
      `${ROUTE} registers name(s) no longer exported by any job file.\n\n` +
        `This fails at runtime on the next deploy, not here.\n\n` +
        ghosts.map((name) => `  ${name}`).join("\n"),
    );
  });

  it("gives every job a unique id", () => {
    const ids = functionFiles.flatMap((file) =>
      [...readSource(file).matchAll(/\bid:\s*["'`]([a-z0-9-]+)["'`]/g)].map((match) => match[1]),
    );

    const seen = new Set<string>();
    const duplicates = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));

    assert.deepEqual(
      [...new Set(duplicates)],
      [],
      `Duplicate job id(s).\n\n` +
        `The second registration overwrites the first on the provider's side, and one\n` +
        `job silently stops firing with no error.`,
    );
  });
});
