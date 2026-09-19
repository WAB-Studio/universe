import { defineConfig, devices } from "@playwright/test";

// No `webServer` block, no `globalSetup`, no `storageState`, no harness lane:
// this app has no identity and no seeded row. A dev server is started and
// kept running by hand, against `next build && next start` — module 22's own
// counting assertions need the single effect run production gives and dev
// does not (docs/TRAPS.md "StrictMode doubles a Worker count").
const baseURL = process.env.VOYAGER_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  // Gitignored, so a run leaves the tree clean.
  outputDir: "./private/playwright-results",
  // Two, never more: the runner this suite really runs on is a private
  // repository's `ubuntu-latest`, which is 2 vCPU. Workers above the core
  // count buy memory pressure, not speed. Measured 2026-09-19 over the whole
  // suite: 370s serial against 182s, 194s and 191s across three parallel
  // runs, all 175 green, none flaky. Four specs reach Supabase auth and can
  // now land in the same window; `retries: 0` below is what would say so.
  workers: 2,
  // A retry would hide a flake behind a green run, which is what this layer
  // exists to find.
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
  },
  // `escritorio.spec.ts` asserts a 1024px+ layout no other spec touches: the
  // `mobile` project below sets no `testMatch`/`testIgnore` of its own, so
  // it inherits this and keeps running the other eleven files exactly as
  // before. `desktop`, further down, opts back in with its own `testIgnore`.
  testIgnore: /escritorio\.spec\.ts$/,
  projects: [
    // RNL-03's base case: a phone, held one-handed, standing.
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 360, height: 740 },
        hasTouch: true,
      },
    },
    // docs/voyager/DESIGN.md "Viewport": the second breakpoint, 1024px, where
    // the bar becomes a sidebar. No `hasTouch`: a desktop, not a tablet.
    // Scoped to the specs that say something about the width, so the rest
    // never double their run time against a viewport they say nothing about.
    // `sin-entrada.spec.ts` joined `escritorio.spec.ts` here (module 6): its
    // own criterion names both projects, unlike its ten siblings.
    {
      name: "desktop",
      testMatch: [/escritorio\.spec\.ts$/, /sin-entrada\.spec\.ts$/],
      testIgnore: [],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
