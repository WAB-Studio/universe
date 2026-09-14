import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

import manifest from "../public/dictionary/manifest.json";

// Chromium's built-in `Translator` hangs `availability()` forever
// (docs/TRAPS.md); the mount effect must never reach it in this suite.
async function deleteTranslator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

async function openWordReady(page: Page, word: string): Promise<void> {
  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto(`/?q=${word}`);
  await assetResponse;
  // The fetch settling is not the worker posting "ready": buildIndex still
  // has to run over 64,258 entries. Give it room before the first keystroke
  // ever reaches an answer.
  await page.waitForTimeout(1200);
}

// Fabricates the gap RNL-03's fallback closes: the browser that reads no
// `interactiveWidget` shrinks `visualViewport` alone and leaves the layout
// viewport — what `window.innerHeight` and every fixed box answer to —
// exactly as it was. Real Chromium here never shrinks either one, so the
// override is the only lever this machine has on the number `bottom-nav.tsx`
// reads; a single in-page `evaluate` after the page has already settled,
// never `addInitScript`, because nothing here navigates again afterwards
// and an init script would only add a second reinjection to reason about
// (docs/TRAPS.md "`addInitScript` reinjects on every navigation, not once").
// The override lives on this document alone: navigate after calling it and it
// is gone, so a spec that navigates has to call it again on the new page.
async function mockKeyboardOpen(page: Page, visibleHeight: number): Promise<void> {
  await page.evaluate((height) => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("this browser has no visualViewport to mock");
    Object.defineProperty(viewport, "height", { configurable: true, get: () => height });
    viewport.dispatchEvent(new Event("resize"));
  }, visibleHeight);
  // The listener's own state write, then the CSS relayout it feeds.
  await page.waitForTimeout(200);
}

// docs/voyager/DESIGN.md "Viewport": a bottom bar under 1024px, a sidebar
// from it up — this test drives both without a second project, since
// `playwright.config.ts` is not a file this module may touch.
async function navBox(page: Page) {
  const box = await page.getByRole("navigation").first().boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

test("the served page asks for a layout viewport that resizes under the keyboard", async ({ page }) => {
  await deleteTranslator(page);
  await page.goto("/");
  const content = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(content).toContain("interactive-widget=resizes-content");
});

test("with nothing mocked, the bar sits exactly where it does today, bar and sidebar alike", async ({
  page,
}) => {
  await deleteTranslator(page);

  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  await page.waitForTimeout(300);
  const barBox = await navBox(page);
  // `--rl-keyboard-inset` unset resolves to `0px`: the same `bottom: 0` the
  // bar has always drawn.
  expect(barBox.y + barBox.height).toBe(740);
  expect(barBox.x).toBe(0);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  const sidebarBox = await navBox(page);
  // docs/voyager/DESIGN.md "Viewport": the 240px band, full height — the
  // desktop rule sets `inset-block: 0` outright and never reads the
  // variable at all, mocked or not.
  expect(sidebarBox.x).toBe(0);
  expect(sidebarBox.width).toBeGreaterThan(238);
  expect(sidebarBox.width).toBeLessThan(242);
  expect(sidebarBox.y).toBe(0);
  expect(sidebarBox.height).toBe(800);
});

test("an open keyboard the browser does not resize the layout for still clears the bar off the keys", async ({
  page,
}) => {
  await deleteTranslator(page);
  await page.setViewportSize({ width: 360, height: 740 });

  await openWordReady(page, "clamp");
  await expect(page.getByRole("heading", { name: "clamp" })).toBeVisible();

  const before = await navBox(page);
  expect(before.y + before.height).toBe(740);

  await mockKeyboardOpen(page, 420);

  const after = await navBox(page);
  // The gap between the real 740px layout viewport and the 420px the
  // keyboard leaves visible: the bar's own bottom edge rides up to sit
  // exactly on that line, never under it.
  expect(after.y + after.height).toBeLessThanOrEqual(420);
  expect(after.x).toBe(0);
});

test("the last line of clamp's answer is reachable past the raised bar, uncovered", async ({ page }) => {
  await deleteTranslator(page);
  await page.setViewportSize({ width: 360, height: 740 });

  await openWordReady(page, "clamp");
  await expect(page.getByRole("heading", { name: "clamp" })).toBeVisible();

  await mockKeyboardOpen(page, 420);
  const bar = await navBox(page);

  // `clamp`'s second sense, the dictionary's own last line — a real
  // headword's real definition, not a fixture.
  const lastLine = page.getByText(
    "(transitive, intransitive) To fasten in place or together with (or as if with) a clamp.",
  );
  await expect(lastLine).toBeAttached();

  // Real Chromium here never actually shrinks under the mock above
  // (docs/TRAPS.md "This machine cannot test a reserved scrollbar" says the
  // same of a scrollbar's width): the page keeps rendering the full 740px
  // it always did, so `scrollIntoViewIfNeeded` finds the line already
  // inside that unshrunk box and never moves. Scroll by exactly the amount
  // that clears the bar's own raised top instead, and prove the document's
  // own scroll room — widened by the same keyboard inset
  // `page.module.css`'s reserve now carries — reaches that far.
  const lineBefore = (await lastLine.boundingBox())!;
  const clearance = 8;
  const needed = Math.max(0, lineBefore.y + lineBefore.height - bar.y + clearance);
  const maxScroll = await page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );
  expect(needed).toBeLessThanOrEqual(maxScroll);

  await page.evaluate((y) => window.scrollTo(0, y), needed);
  await page.waitForTimeout(150);

  const lineAfter = (await lastLine.boundingBox())!;
  const barAfter = await navBox(page);
  expect(lineAfter.y + lineAfter.height).toBeLessThanOrEqual(barAfter.y);
});
