/**
 * Guards that do not apply to this repo YET, and the condition that wakes each.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Some rules are worth enforcing but have nothing to enforce against on day 0.
 * `mdx-no-html-comments` asserts it found `.mdx` files; in a repo with no
 * content directory that assertion is red on the first commit.
 *
 * There are three tempting wrong answers, and all three have been shipped
 * somewhere:
 *
 *   - Delete the test. It never comes back. The rule is relearned by paying
 *     for the incident again.
 *   - Weaken the sentinel to `>= 0`. Now it is dead forever and looks alive.
 *   - `if (files.length === 0) return;`. Silently dead, and indistinguishable
 *     from a healthy run — the exact disease this kit treats.
 *
 * The answer here: skip the guard explicitly, record WHY, and make the wake
 * condition executable. `_kit-selfcheck.test.ts` evaluates every `wakes()` and
 * FAILS if one returns true. The moment the first `.mdx` file lands, the suite
 * goes red telling you to activate the guard.
 *
 * A rule that does not apply yet stops being an invisible hole and becomes a
 * scheduled alarm.
 *
 * This is a `seeds/` file — it is YOURS. Add and remove entries freely.
 */

import { readFileSync } from "node:fs";
import { walkFiles } from "./source-scan";

export interface DormantGuard {
  /** Matches the test filename it will become, without `.test.ts`. */
  id: string;
  /** Why it is asleep. Written for someone who has never seen this repo. */
  reason: string;
  /** What to do when it wakes. */
  activate: string;
  /** True when the guard should now be active. Kept cheap — this runs every suite. */
  wakes: () => boolean;
}

export const DORMANT: readonly DormantGuard[] = [
  {
    id: "mdx-no-html-comments",
    reason: "No .mdx files under src/content yet.",
    activate:
      "Copy examples/mdx-no-html-comments.test.ts into tests/unit/conventions/ and delete this entry.",
    wakes: () => walkFiles("src/content", [".mdx"]).length > 0,
  },
  // `dbconnect-coverage` used to sit here, and it was a bug in two directions.
  //
  // It ships in seeds/ — install.mjs copies it, and it runs ACTIVE from day 0
  // behind its own SCAN_FLOOR. So the entry claimed a guard was asleep while it
  // was already enforcing. Worse, its wake condition (>= 10 action/API files)
  // is met by any real app, so _kit-selfcheck would go red telling you to
  // "activate" it by copying examples/dbconnect-coverage.test.ts — a path that
  // has never existed.
  //
  // A guaranteed false alarm pointing at a missing file, inside the mechanism
  // built to prevent exactly that. Left as a comment because the failure is
  // more instructive than the fix: a dormant entry and a shipped seed are
  // mutually exclusive, and nothing was checking which one a guard was.
  {
    id: "ai-durable-limit",
    reason: "No AI SDK usage yet, so there is no model spend to rate-limit.",
    activate:
      "Copy examples/ai-durable-limit.test.ts into tests/unit/conventions/. Every path that spends " +
      "money on a model needs a DURABLE limit — an in-memory one resets on every cold start.",
    wakes: () => {
      const files = [
        ...walkFiles("src/lib", [".ts"]),
        ...walkFiles("src/app", [".ts"]),
      ];
      return files.some((f) => {
        try {
          return /@ai-sdk\/|from "ai"|@google\/genai|groq-sdk|@anthropic-ai\/sdk/.test(
            readFileSync(f, "utf8"),
          );
        } catch {
          return false;
        }
      });
    },
  },
  {
    id: "job-registration-parity",
    reason: "No background-job directory exists yet.",
    activate:
      "Copy examples/job-registration-parity.test.ts. Every job function must appear in the serve() " +
      "registration, in both directions — an unregistered job never runs and nothing tells you.",
    wakes: () => walkFiles("src/lib/inngest/functions", [".ts"]).length > 0,
  },
];
