/**
 * Parsing a PDF must not change how Auth.js encodes session cookies.
 *
 * WHAT HAPPENED
 *
 * One bank-statement upload signed out EVERY user on that server process until
 * it restarted. Every request then failed with
 *   JWTSessionError → JWEInvalid: Failed to base64url decode the ciphertext
 *
 * unpdf bundles PDF.js. On Node < 25 the first real PDF parse installs global
 * `Uint8Array.fromBase64` / `Uint8Array.prototype.toBase64` polyfills that
 * IGNORE the `alphabet` and `omitPadding` options. jose — Auth.js's JWE layer —
 * feature-detects those globals and prefers them, asking for base64url. From
 * then on Node wrote tokens in standard base64 (`+ / =`) while middleware, in
 * its own unpolyfilled sandbox, still spoke base64url. Each side rejected the
 * other's cookies; middleware deleted the cookie on the failed read.
 *
 * It cost a full evening, and the bisect lied: swapping next-auth versions
 * "fixed" it only because the swap included a restart. Nothing in the diff of
 * either package touched cookies. Read the diff before trusting a bisect.
 *
 * WHY A BEHAVIOURAL TEST, NOT A SOURCE SCAN
 *
 * No line of your code is wrong — the bug is two dependencies meeting in a
 * shared global. Only running them together, in a fresh process, sees it. This
 * file runs in its own process under `node --test`, so the realm starts clean:
 * nothing else has installed or repaired the globals first.
 *
 * THE FIX THIS GUARDS
 *
 * Install spec-compliant helpers before PDF.js can (PDF.js only installs a
 * helper when it is missing), and replace non-compliant ones. Do it at server
 * start (Next.js `instrumentation.ts` → `register()` on the nodejs runtime) AND
 * at the top of your extraction module, so tests and scripts are covered too.
 *
 * ACTIVATION
 *
 * Copy into `tests/unit/conventions/` and delete the `pdfjs-base64-auth-tokens`
 * entry from `_dormant.ts`. Point EXTRACT_MODULE / EXTRACT_EXPORT at YOUR
 * function that turns PDF bytes into text — the defaults will not match your
 * code. It must go through your real entry point: calling unpdf directly would
 * skip your guard and fail for the wrong reason.
 *
 * Prove it fails first: comment out your shim call and run it. It goes red.
 *
 * Run: npx tsx --test tests/unit/conventions/pdfjs-base64-auth-tokens.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Your module that extracts text from PDF bytes. */
const EXTRACT_MODULE = "src/lib/statements/pdfText.ts";
/** Its exported function: (bytes: Uint8Array) => Promise<string>. */
const EXTRACT_EXPORT = "extractPdfText";

/** Smallest valid one-page PDF with a line of Helvetica text. */
function tinyPdf(): Uint8Array {
  const content = "BT /F1 10 Tf 40 780 Td (guard) Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

type B64Proto = Uint8Array & { toBase64?: (o?: { alphabet?: string; omitPadding?: boolean }) => string };

describe("PDF parsing vs Auth.js session encoding", () => {
  it("leaves base64 globals spec-compliant after a REAL parse through your entry point", async () => {
    const mod = (await import(pathToFileURL(resolve(EXTRACT_MODULE)).href)) as Record<string, unknown>;
    const extract = mod[EXTRACT_EXPORT];
    assert.equal(typeof extract, "function", `${EXTRACT_MODULE} must export ${EXTRACT_EXPORT}`);
    await (extract as (b: Uint8Array) => Promise<string>)(tinyPdf());

    const proto = Uint8Array.prototype as B64Proto;
    if (typeof proto.toBase64 === "function") {
      // [251, 255] is "+/8" in base64 and "-_8" in base64url: the two alphabets differ here.
      const url = (new Uint8Array([251, 255]) as B64Proto).toBase64!({ alphabet: "base64url", omitPadding: true });
      assert.equal(url, "-_8", "a non-compliant Uint8Array.prototype.toBase64 is installed — jose will write base64 into session cookies");
    }
  });

  it("still produces base64url Auth.js tokens that decode", async () => {
    const { encode, decode } = await import("@auth/core/jwt");
    const secret = "verify-kit-guard-secret-".repeat(2);
    const salt = "authjs.session-token";
    const token = await encode({ token: { sub: "guard" }, secret, salt });
    assert.match(token, /^[A-Za-z0-9_.-]+$/, "session token contains + / = — it will be unreadable elsewhere");
    assert.equal((await decode({ token, secret, salt }))?.sub, "guard");
  });
});
