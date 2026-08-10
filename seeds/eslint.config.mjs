// @ts-check
/**
 * ESLint, incident-derived only.
 *
 * THE ONE RULE ABOUT RULES
 *
 * This config deliberately adopts NO recommended set — not `eslint:recommended`,
 * not `typescript-eslint`'s recommended, and specifically not `eslint-config-next`.
 * A recommended set surfaces hundreds of findings unrelated to any bug this
 * project has actually had, and a config that shouts on day one gets disabled
 * within a week. A disabled linter enforces nothing, which is strictly worse
 * than a small one.
 *
 * Every rule below maps to a bug that shipped somewhere. To add one, bring the
 * commit that justifies it.
 *
 * THE BAR CHANGES ON TRANSPLANT. Read literally, "bring the commit" would mean
 * a new app must re-earn every bug before it may guard against it — including
 * the hydration bug that shipped four times. So the bar is: the evidence must be
 * a real incident, not a real incident IN THIS REPO. Rules whose cause is
 * stack-level and inevitable ship active. Rules whose cause is app-specific ship
 * commented out, with the incident attached, as a worked example.
 *
 * This is a `seeds/` file — it is YOURS. Add rules as you earn them.
 */

import tseslint from "typescript-eslint";

/**
 * Hydration mismatch, shipped 4× in the source app (05-17 ×2, 06-15, 07-09).
 * Server formats against UTC, browser against local. Stack-level: any SSR app
 * on a UTC host with a single-country audience hits this.
 */
const NO_UNPINNED_DATE_FORMAT = {
  selector:
    'CallExpression[callee.property.name=/^toLocale(Date|Time|)String$/]:not(:has(Property[key.name="timeZone"]))',
  message:
    "Pass an explicit { timeZone }. Without it the server formats against UTC and the " +
    "browser against the viewer's zone — near midnight they disagree and React throws a " +
    "hydration mismatch.",
};

const NO_UNPINNED_INTL_FORMAT = {
  selector:
    'NewExpression[callee.object.name="Intl"][callee.property.name="DateTimeFormat"]:not(:has(Property[key.name="timeZone"]))',
  message:
    "Pass an explicit { timeZone } to Intl.DateTimeFormat — same hydration mismatch as " +
    "toLocaleDateString, different spelling.",
};

/**
 * A caught-and-dropped error is not defensive code.
 * 17 commits in the source app existed only to surface an error that had been
 * swallowed. `allowEmptyCatch: false` is the entire point of including no-empty.
 */
const NO_SILENT_CATCH = "error";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "dist/**",
      "build/**",
      "coverage/**",
      ".verify-kit/**",
      "next-env.d.ts",
    ],
  },

  {
    files: ["**/*.{ts,tsx,mjs,cjs,js,jsx}"],
    /**
     * The parser must be set EXPLICITLY.
     *
     * `tseslint.config()` is only a typed helper for composing flat-config
     * objects — it does not install a parser. That normally arrives with
     * `tseslint.configs.recommended`, which this config deliberately does not
     * adopt. Without this block, every `.ts` file fails with
     * "Parsing error: Unexpected token interface" and the linter enforces
     * nothing while appearing to run.
     */
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    linterOptions: {
      /**
       * Turn this on THE DAY the linter lands.
       *
       * The source app accumulated 62 `eslint-disable` comments over four months
       * during which no ESLint was installed. 32 cited rules from plugins that
       * were never added, so the very first lint run failed on COMMENTS rather
       * than on code. A disable comment that suppresses nothing is worse than no
       * comment: it reads as "this rule was considered and waived" when in fact
       * the rule never ran.
       */
      reportUnusedDisableDirectives: "warn",
    },
    rules: {
      "no-restricted-syntax": [
        "warn",
        NO_UNPINNED_DATE_FORMAT,
        NO_UNPINNED_INTL_FORMAT,

        // ── WORKED EXAMPLE — uncomment when you add a deployment-identity gate ──
        //
        // NODE_ENV === "production" is NOT "in production". A local
        // `next build && next start` sets it too, so gating error reporting on it
        // shipped the developer's own localhost errors into the production issue
        // queue — 3 of 5 unresolved issues, one stacktrace naming the worktree it
        // was built in. VERCEL_ENV is the deployment-identity variable.
        //
        // Two traps if you write this gate: it must FAIL OPEN (a gate that
        // wrongly returns false destroys all production error visibility, which
        // is worse than the noise), and the browser cannot read VERCEL_ENV at all
        // — only a NEXT_PUBLIC_ mirror, so back the client with a
        // window.location.hostname check.
        //
        // {
        //   selector:
        //     'BinaryExpression[operator=/^[!=]==$/] > MemberExpression[property.name="NODE_ENV"]',
        //   message:
        //     "NODE_ENV does not identify a deployment — a local production build sets it too. " +
        //     "Use VERCEL_ENV (or your platform's deployment-identity variable).",
        // },
      ],

      "no-empty": [NO_SILENT_CATCH, { allowEmptyCatch: false }],
      "no-debugger": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  /**
   * Convention tests necessarily CONTAIN the strings they forbid, and scripts
   * are meant to print. Scoping severity per path is what keeps the rules
   * credible where they do apply.
   */
  {
    files: ["tests/**/*.ts", "scripts/**/*.{ts,mjs,js}"],
    rules: {
      "no-restricted-syntax": "off",
      "no-console": "off",
    },
  },

  /**
   * The module that OWNS the timezone constant is the one place a zone literal
   * and an unpinned format helper legitimately live.
   */
  {
    files: ["src/lib/datetime.ts"],
    rules: { "no-restricted-syntax": "off" },
  },

  // ── BASELINE ──────────────────────────────────────────────────────────────
  // Empty on day 0: a fresh repo has no violations to silence.
  //
  // `install.mjs --baseline` fills this during a retrofit, as override blocks
  // applied LAST. Two properties matter: flat config rejects an empty `files`
  // array, so each block needs a spread guard; and a baseline silences only the
  // editor warning — baselined files still count toward the convention-test
  // ratchets, so enforcement is not removed.
  //
  // Escaping gotcha for Next.js apps: dynamic segments must be escaped —
  //   "src/app/(dashboard)/\\[slug\\]/page.tsx"
  // An unescaped [slug] is a character class matching one of s/l/u/g and will
  // never match the real path. Route-group parens are literal and need no escape.
);
