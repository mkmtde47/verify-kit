/**
 * A path that spends money on a model must be limited DURABLY.
 *
 * WHAT HAPPENED
 *
 * An in-memory rate limiter keeps its buckets in a module-scoped Map, so on a
 * serverless platform each instance counts on its own. A "20 requests a day"
 * cap becomes 20 × however many instances happen to be warm, which is not a
 * cap. The limiter in the app this kit came from said so in its own header —
 * "distributed brute-force across instances is NOT blocked" — and named the
 * durable swap as a follow-up that had not happened.
 *
 * That matters most exactly where a product is deliberately generous. The two
 * most exposed surfaces there were open by design: one a no-login viral hook,
 * the other free for every provider because it was the supply engine. Both were
 * good product decisions, and both were only affordable if the guard around
 * them actually held. It didn't.
 *
 * The asymmetry is what makes this worth a ratchet. An unlimited model path
 * does not degrade — it bills. There is no slow warning; there is a spike.
 *
 * WHY A DURABLE LIMITER IS STRICTLY SAFER
 *
 * A well-built `limitDurable` falls back to the in-memory limiter when the
 * store's credentials are absent, and never throws. Worst case it is
 * byte-for-byte the old behaviour, so there is no reason to prefer the
 * in-memory call at a site that spends money.
 *
 * SCOPE
 *
 * Only model-calling paths. Your in-memory limiter is probably still used for
 * auth and export throttling, and those deserve the same treatment eventually —
 * but they are a different concern from model spend and are not what this
 * guard is about. Widening it is how it becomes the test everyone disables.
 *
 * ACTIVATION
 *
 * Copy into `tests/unit/conventions/` and delete the `ai-durable-limit` entry
 * from `_dormant.ts`. Then set the three regexes below to your own helper
 * names — the defaults will not match your code.
 *
 * On first activation `assertScanned` will fail with "the repo has outgrown the
 * floor — raise it to N". That is expected, not a bug: a dormant guard wakes
 * mid-life, so the day-0 floor below is always stale by then. Set SCAN_FLOOR to
 * the number the message names. The floor is a two-sided ratchet — it proves the
 * walker is alive AND stays meaningful as the repo grows.
 *
 * Run: npx tsx --test tests/unit/conventions/ai-durable-limit.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assertScanned, readSource, walkFiles } from "./source-scan";

/** Where request handlers live. */
const SCAN_DIRS: readonly string[] = ["src/app/api", "src/lib/actions"];

const SCAN_FLOOR = 3;

/**
 * Evidence that a file reaches a paid model.
 *
 * An import from your own AI helper directory is the general signal and the one
 * that matters: most callers never name a provider, they call a helper. The
 * provider SDKs are listed too, for handlers that skip the helper layer.
 *
 * NOTE THE MISSING `\b` — deliberately. A boundary before `@google` can never
 * match, because `\b` needs a word character on one side and both `@` and the
 * space before it are non-word. That exact mistake silently excluded a live
 * route from an earlier version of this guard: it read as covered while
 * covering nothing. Only the trailing alternation is boundary-wrapped.
 */
const AI_CALL =
  /from "@\/lib\/ai\/|@google\/genai|groq-sdk|@anthropic-ai\/sdk|openai|new Groq|\b(runObject|runText|generateObject|generateText|streamText)\b/;

/** The in-memory limiter, invoked. A bare `getClientKey` import is fine. */
const IN_MEMORY_LIMIT_CALL = /(?<![\w.])rateLimit\s*\(/;

/** The durable limiter, invoked. */
const DURABLE_LIMIT_CALL = /limitDurable\s*\(/;

/**
 * Model-calling paths that legitimately carry no durable limit, each with the
 * reason. Empty to start; the staleness check goes live on the first entry.
 *
 * "It is behind auth" is not sufficient on its own — an authenticated user can
 * still run up a bill. State the actual bound (a quota check, a per-account
 * counter, a hard cap upstream).
 */
const UNLIMITED_ALLOWANCE: Readonly<Record<string, string>> = {};

interface Handler {
  file: string;
  durable: boolean;
  inMemoryOnly: boolean;
}

function modelSpendingHandlers(): { scanned: string[]; handlers: Handler[] } {
  const scanned = SCAN_DIRS.flatMap((dir) => walkFiles(dir, [".ts"]));

  const handlers = scanned
    .filter((file) => !file.includes(".test."))
    .map((file) => ({ file, source: readSource(file) }))
    .filter(({ source }) => AI_CALL.test(source))
    .map(({ file, source }) => {
      const durable = DURABLE_LIMIT_CALL.test(source);
      return {
        file,
        durable,
        inMemoryOnly: !durable && IN_MEMORY_LIMIT_CALL.test(source),
      };
    });

  return { scanned, handlers };
}

describe("convention: model spend is limited durably", () => {
  const { scanned, handlers } = modelSpendingHandlers();

  it("scanned the handler surface", () => {
    assertScanned(scanned, {
      name: "ai-durable-limit",
      dir: SCAN_DIRS.join(", "),
      floor: SCAN_FLOOR,
    });
  });

  it("has no model-calling path without a durable limit", () => {
    const offenders = handlers
      .filter((handler) => !handler.durable)
      .filter((handler) => !(handler.file in UNLIMITED_ALLOWANCE))
      .map(
        (handler) =>
          `  ${handler.file}` +
          (handler.inMemoryOnly ? "  (in-memory limiter only — resets per instance)" : "  (no limit at all)"),
      );

    assert.deepEqual(
      offenders,
      [],
      `A path that spends money on a model is not durably rate-limited.\n\n` +
        `An in-memory limiter counts per serverless instance, so the effective cap is\n` +
        `your limit multiplied by however many instances are warm. On a model path that\n` +
        `does not degrade gracefully — it bills.\n\n` +
        `Swap the call for the durable limiter. If it falls back to in-memory when the\n` +
        `store is unconfigured, the swap is strictly safe: worst case it is identical\n` +
        `to what you have now.\n\n` +
        `${offenders.join("\n")}`,
    );
  });

  it("keeps UNLIMITED_ALLOWANCE free of stale entries", () => {
    const byFile = new Map(handlers.map((handler) => [handler.file, handler]));
    const stale: string[] = [];

    for (const file of Object.keys(UNLIMITED_ALLOWANCE)) {
      const found = byFile.get(file);
      if (!found) {
        stale.push(`  ${file}: no longer calls a model — remove the entry`);
      } else if (found.durable) {
        stale.push(`  ${file}: now durably limited — remove the entry to bank the win`);
      }
    }

    assert.deepEqual(stale, [], `UNLIMITED_ALLOWANCE is out of date.\n${stale.join("\n")}`);
  });
});
