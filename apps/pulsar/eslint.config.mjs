import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "private/**",
  ]),
  {
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "localStorage",
          message: "Reach a store from `lib/` only.",
        },
        {
          name: "sessionStorage",
          message: "Reach a store from `lib/` only.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/db/client"],
              message:
                "The only doors to this app's tables are `withGoalsDb` and `withReadingDb`, from `@/lib/session`.",
            },
          ],
        },
      ],
      // `no-restricted-imports` does not see `import()`: it inspects
      // `ImportDeclaration` and `Export...Declaration`, never `ImportExpression`.
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression[source.value=/(^|\\/)db\\/client$/]",
          message:
            "The only doors to this app's tables are `withGoalsDb` and `withReadingDb`, from `@/lib/session`.",
        },
      ],
    },
  },
  // `lib/` is where the stores live, so it is the one place allowed to name them.
  {
    files: ["lib/**"],
    rules: { "no-restricted-globals": "off" },
  },
  // `session.ts` settles the connection before every query it runs — the one
  // file allowed to hold the raw pool the rules above forbid everywhere else.
  {
    files: ["lib/session.ts"],
    rules: { "no-restricted-imports": "off", "no-restricted-syntax": "off" },
  },
  // A spec asserts what the device really holds, so it reads the store the
  // browser exposes rather than the one the app imports.
  {
    files: ["e2e/**"],
    rules: { "no-restricted-globals": "off" },
  },
]);

export default eslintConfig;
