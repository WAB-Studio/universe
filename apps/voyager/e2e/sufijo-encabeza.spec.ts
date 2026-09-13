import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";

// Chromium's built-in `Translator` hangs `availability()` forever
// (docs/TRAPS.md); the mount effect must never reach it in this suite.
async function deleteTranslator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

async function loadDictionary(page: Page): Promise<void> {
  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  // The fetch settling is not the worker posting "ready": buildIndex still
  // has to run over 64,258 entries. Give it room before cutting the network.
  await page.waitForTimeout(1000);
}

// True when `first`'s own text sits before `second`'s in document order —
// the screen's own leading sense is whichever one a reader's eye meets
// first, not whichever label a query happens to name first.
async function textLeads(page: Page, first: string, second: string): Promise<boolean | null> {
  return page.evaluate(
    ({ first, second }) => {
      const nodes = Array.from(document.querySelectorAll("span, p"));
      const a = nodes.find((n) => n.textContent === first);
      const b = nodes.find((n) => n.textContent === second);
      if (!a || !b) return null;
      return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    },
    { first, second },
  );
}

// The five forms the validator measured live against the screen on
// 2026-09-12 (docs/voyager/DESIGN.md "Pruning the dictionary was measured
// and refused"): each carries a suffix only one category takes, and each
// used to lead with the other one.
test("`sternly`'s `-ly` fixes the adjective, so `stern` leads with «severo», not «popa»", async ({ page }) => {
  await deleteTranslator(page);
  await loadDictionary(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("sternly");
  await expect(page.getByRole("heading", { name: "stern", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("severo", { exact: true })).toBeVisible();
  await expect(page.getByText("popa", { exact: true })).toBeVisible();
  expect(await textLeads(page, "severo", "popa")).toBe(true);
});

test("`shrieked`'s `-ed` fixes the verb, so `shriek` leads with «chillar», not «alarido»", async ({ page }) => {
  await deleteTranslator(page);
  await loadDictionary(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("shrieked");
  await expect(page.getByRole("heading", { name: "shriek", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("chillar", { exact: true })).toBeVisible();
  await expect(page.getByText("alarido", { exact: true })).toBeVisible();
  expect(await textLeads(page, "chillar", "alarido")).toBe(true);
});

test("`toiled`'s `-ed` fixes the verb, so `toil` leads with «afanar», not «esfuerzo»", async ({ page }) => {
  await deleteTranslator(page);
  await loadDictionary(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("toiled");
  await expect(page.getByRole("heading", { name: "toil", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("afanar", { exact: true })).toBeVisible();
  await expect(page.getByText("esfuerzo", { exact: true })).toBeVisible();
  expect(await textLeads(page, "afanar", "esfuerzo")).toBe(true);
});

test("`creeping` and `frosted` both fix the verb through `-ing`/`-ed`", async ({ page }) => {
  await deleteTranslator(page);
  await loadDictionary(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });

  await searchBox.fill("creeping");
  await expect(page.getByRole("heading", { name: "creep", exact: true })).toBeVisible({ timeout: 5000 });
  expect(await textLeads(page, messages.word.pos.v, messages.word.pos.n)).toBe(true);

  await searchBox.fill("frosted");
  await expect(page.getByRole("heading", { name: "frost", exact: true })).toBeVisible({ timeout: 5000 });
  expect(await textLeads(page, messages.word.pos.v, messages.word.pos.n)).toBe(true);
});

// Negative control: an exact, uninflected query carries no suffix to pin a
// category, so the clause never fires and the group's order is untouched.
// `bed` (noun leads) and `clamp` (verb leads) are unaffected by this
// module's own baseline probe, and stay that way here.
test("an exact query with no inflection keeps today's order, unpinned", async ({ page }) => {
  await deleteTranslator(page);
  await loadDictionary(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });

  await searchBox.fill("bed");
  await expect(page.getByRole("heading", { name: "bed", exact: true })).toBeVisible({ timeout: 5000 });
  expect(await textLeads(page, messages.word.pos.n, messages.word.pos.v)).toBe(true);

  await searchBox.fill("clamp");
  await expect(page.getByRole("heading", { name: "clamp", exact: true })).toBeVisible({ timeout: 5000 });
  expect(await textLeads(page, messages.word.pos.v, messages.word.pos.n)).toBe(true);
});
