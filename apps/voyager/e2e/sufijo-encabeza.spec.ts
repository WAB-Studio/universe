import { expect, test } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

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
// first, not whichever label a query happens to name first. A gloss can
// share its line with the sense's other translations
// (docs/voyager/DESIGN.md "The translations are one line, separated by
// commas"), so the match is bounded by the line's own start, end or `, `
// rather than an exact `textContent` — a POS label such as "verbo" is a
// line of its own either way and still matches.
async function textLeads(page: Page, first: string, second: string): Promise<boolean | null> {
  return page.evaluate(
    ({ first, second }) => {
      const glossNode = (gloss: string) =>
        Array.from(document.querySelectorAll("span, p")).find((n) =>
          new RegExp(`(^|, )${gloss}(,|$)`).test(n.textContent ?? ""),
        );
      const a = glossNode(first);
      const b = glossNode(second);
      if (!a || !b) return null;
      return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    },
    { first, second },
  );
}

// The same boundary match as `textLeads`, for a single gloss's own
// visibility rather than the order of two.
function glossLocator(page: Page, gloss: string): Locator {
  const escaped = gloss.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByText(new RegExp(`(^|, )${escaped}(,|$)`));
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
  await expect(glossLocator(page, "severo")).toBeVisible();
  await expect(glossLocator(page, "popa")).toBeVisible();
  expect(await textLeads(page, "severo", "popa")).toBe(true);
  // `glossLocator` alone would pass just as well against the old
  // one-gloss-per-line markup; this is the line that actually holds the
  // adjective's translations joined (docs/voyager/DESIGN.md "The
  // translations are one line, separated by commas").
  await expect(page.getByText("severo, apremiante, adusto", { exact: true })).toBeVisible();
});

test("`shrieked`'s `-ed` fixes the verb, so `shriek` leads with «chillar», not «alarido»", async ({ page }) => {
  await deleteTranslator(page);
  await loadDictionary(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("shrieked");
  await expect(page.getByRole("heading", { name: "shriek", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(glossLocator(page, "chillar")).toBeVisible();
  await expect(glossLocator(page, "alarido")).toBeVisible();
  expect(await textLeads(page, "chillar", "alarido")).toBe(true);
  // Same proof as `sternly`'s own: the noun's two glosses join on one line.
  await expect(page.getByText("alarido, chillido", { exact: true })).toBeVisible();
});

test("`toiled`'s `-ed` fixes the verb, so `toil` leads with «afanar», not «esfuerzo»", async ({ page }) => {
  await deleteTranslator(page);
  await loadDictionary(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("toiled");
  await expect(page.getByRole("heading", { name: "toil", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(glossLocator(page, "afanar")).toBeVisible();
  await expect(glossLocator(page, "esfuerzo")).toBeVisible();
  expect(await textLeads(page, "afanar", "esfuerzo")).toBe(true);
  // Same proof: the noun's two glosses join on one line.
  await expect(page.getByText("esfuerzo, deslomadura", { exact: true })).toBeVisible();
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
