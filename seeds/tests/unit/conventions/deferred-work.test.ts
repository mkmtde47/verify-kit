/**
 * Background work started by a server action must survive the response.
 *
 * WHAT HAPPENED
 *
 * In the app this kit came from, an event emitter was called as a bare floating
 * promise:
 *
 *     void emitAppointmentConfirmed({ … });
 *
 * On serverless the invocation can be frozen the moment the action returns its
 * response. That function is `async` and does `await dbConnect()` →
 * `await Model.findById()` → `await send()`, so the chain never reached the
 * send. No error, no log, no event — reminders simply stopped, in production,
 * for weeks.
 *
 * It survived review because the code it replaced looked equivalent:
 *
 *     send({ … }).catch(…)     // one call, started immediately
 *
 * Adding a DB connection and a query in front of the send widened the
 * termination window from "almost none" to "reliably lost". The same file
 * already wrapped its confirmation email in `after()` for exactly this reason —
 * the email arrived and the event did not, in the same code branch.
 *
 * WHY A TEST AND NOT A COMMENT
 *
 * A floating promise is invisible: nothing throws, nothing logs, and the happy
 * path looks identical. It was found only by exercising production and watching
 * an event that should have fired not fire. That is far too expensive a way to
 * catch it twice.
 *
 * `after(() => fn(…))` and `await fn(…)` both survive a frozen invocation and
 * neither matches the banned shape, so the fix is always available and never
 * requires an exception.
 *
 * THIS IS A `seeds/` FILE — IT IS YOURS.
 *
 * `MUST_NOT_FLOAT` is empty on day 0 and that is correct: the guard has nothing
 * to protect until you have async work that reaches a third party. Add each
 * such function as you write it — an emitter, a webhook dispatcher, a payment
 * capture. Adding a name here is cheaper than rediscovering this bug.
 *
 * Run: npx tsx --test tests/unit/conventions/deferred-work.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { walkFiles, readSource, assertScanned } from "./source-scan";

const SCANNED_DIR = "src";

/** Raise as the repo grows; the sentinel nags when it has outgrown this. */
const SCAN_FLOOR = 3;

/**
 * Async work that reaches a third party and must not be left floating.
 *
 * Add to this list rather than starting a new guard. Names are matched as
 * `void <name>(`, so a rename silently empties the guard — which is what the
 * second test below exists to catch.
 */
const MUST_NOT_FLOAT: readonly string[] = [];

const sourceFiles = walkFiles(SCANNED_DIR, [".ts", ".tsx"]);

describe("deferred work survives the response", () => {
  it("scanned a plausible number of files", () => {
    assertScanned(sourceFiles, {
      name: "deferred-work",
      dir: SCANNED_DIR,
      floor: SCAN_FLOOR,
    });
  });

  it("still finds the surface it is meant to guard", () => {
    // Nothing registered yet is a legitimate day-0 state. But a name that is
    // registered and appears NOWHERE means it was renamed or deleted, and this
    // guard is now protecting nothing while continuing to pass.
    const missing = MUST_NOT_FLOAT.filter(
      (fn) => !sourceFiles.some((file) => readSource(file).includes(`${fn}(`)),
    );

    assert.deepEqual(
      missing,
      [],
      `Registered in MUST_NOT_FLOAT but no call site exists:\n` +
        missing.map((fn) => `  ${fn}`).join("\n") +
        `\n\nEither it was renamed — update the list — or it is gone and the\n` +
        `entry should be removed. A guard whose subject does not exist passes\n` +
        `every run and enforces nothing.`,
    );
  });

  it("never starts one as a bare floating promise", () => {
    const floating: string[] = [];

    for (const file of sourceFiles) {
      const source = readSource(file);
      for (const fn of MUST_NOT_FLOAT) {
        // `void fn(` is the exact shape that was lost. `after(() => fn(…))`
        // and `await fn(…)` both survive, and neither matches this.
        const pattern = new RegExp(`void\\s+${fn}\\s*\\(`, "g");
        for (const match of source.matchAll(pattern)) {
          const line = source.slice(0, match.index).split("\n").length;
          floating.push(`  ${file}:${line}  void ${fn}(...)`);
        }
      }
    }

    assert.deepEqual(
      floating,
      [],
      `Floating promise(s) in a server action or route handler.\n` +
        `The invocation can be frozen when the response is sent, so an async\n` +
        `chain that awaits a DB connection before its network call never\n` +
        `completes — silently, with no error and no log.\n` +
        `Wrap in after(() => …) from "next/server", or await it.\n` +
        floating.join("\n"),
    );
  });
});
