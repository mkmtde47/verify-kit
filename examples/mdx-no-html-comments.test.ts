/**
 * MDX may not contain HTML comments.
 *
 * WHAT HAPPENED
 *
 * MDX parses `{/* … *\/}`, not `<!-- … -->`. An HTML comment is not a comment
 * there — it is content the parser chokes on, and it fails at PRERENDER, which
 * is the worst place for it. `tsc --noEmit` stays green. The unit suite stays
 * green. The break appears only during a full production build.
 *
 * Shipped once in the app this kit came from: a privacy policy edited with HTML
 * comment syntax took down the build, having passed every local gate.
 *
 * This is the cheapest possible check for a failure mode that otherwise needs a
 * full build to catch, which is why it is worth having even though the build
 * would eventually find it.
 *
 * ACTIVATION
 *
 * Copy this file into `tests/unit/conventions/` and delete the
 * `mdx-no-html-comments` entry from `_dormant.ts`. Point `CONTENT_DIRS` at
 * wherever your MDX lives.
 *
 * On first activation `assertScanned` will fail with "the repo has outgrown the
 * floor — raise it to N". That is expected, not a bug: a dormant guard wakes
 * mid-life, so the day-0 floor below is always stale by then. Set SCAN_FLOOR to
 * the number the message names. The floor is a two-sided ratchet — it proves the
 * walker is alive AND stays meaningful as the repo grows.
 *
 * Run: npx tsx --test tests/unit/conventions/mdx-no-html-comments.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assertScanned, readSource, walkFiles } from "./source-scan";

/** Where MDX content lives. Adjust to your layout. */
const CONTENT_DIRS: readonly string[] = ["src/content"];

/**
 * Floor of 1, not 3: this guard wakes the moment the FIRST `.mdx` file lands,
 * and a single content file is a legitimate steady state for a repo with one
 * legal page. The floor is here to catch a renamed directory, nothing else.
 */
const SCAN_FLOOR = 1;

const mdxFiles = CONTENT_DIRS.flatMap((dir) => walkFiles(dir, [".mdx"]));

describe("convention: MDX comment syntax", () => {
  it("found the MDX content to scan", () => {
    assertScanned(mdxFiles, {
      name: "mdx-no-html-comments",
      dir: CONTENT_DIRS.join(", "),
      floor: SCAN_FLOOR,
    });
  });

  it("uses no HTML comments anywhere in MDX", () => {
    const offenders: string[] = [];

    for (const file of mdxFiles) {
      readSource(file)
        .split("\n")
        .forEach((line, index) => {
          if (line.includes("<!--")) {
            offenders.push(`  ${file}:${index + 1}  ${line.trim().slice(0, 100)}`);
          }
        });
    }

    assert.deepEqual(
      offenders,
      [],
      `HTML comment(s) found in MDX.\n\n` +
        `MDX does not parse <!-- -->. This breaks the PRERENDER step only — tsc and\n` +
        `the unit suite stay green, so it reaches the build and fails there.\n\n` +
        `Use {/* … */} instead.\n\n${offenders.join("\n")}`,
    );
  });
});
