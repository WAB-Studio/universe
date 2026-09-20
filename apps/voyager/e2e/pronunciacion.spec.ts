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
  // has to run over 64,258 entries. Give it room before the box is used.
  await page.waitForTimeout(1000);
}

// The IPA heading each pronunciation block of the entry at the top of the
// screen, in document order — bounded by the second `h1`, so an inflection
// offered underneath (RL-47) never lends the entry a block of its own. The
// empty string is the block that gathers senses carrying no IPA, drawn with
// no head at all.
async function blockHeads(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("main h1"));
    const offer = headings[1];
    return Array.from(document.querySelectorAll("main [data-pronunciation-block]"))
      .filter((block) => !offer || Boolean(block.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING))
      .map((block) => block.getAttribute("data-pronunciation-block") ?? "");
  });
}

async function answer(page: Page, word: string): Promise<void> {
  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill(word);
  await expect(page.getByRole("heading", { name: word, exact: true })).toBeVisible({ timeout: 5000 });
}

// RL-51, board `PalabraPronunciacionOscuroMovil`: `row` is two words wearing
// one spelling. Sorted by part of speech alone, its two `/ɹaʊ/` senses land
// at positions three and five of five — a reader who met «a row» as a fight
// sweeps the whole entry twice.
test("RL-51: `row` answers as two pronunciation blocks, /rɑː/ first, its fight senses together", async ({
  page,
}) => {
  await deleteTranslator(page);
  await loadDictionary(page);
  await answer(page, "row");

  expect(await blockHeads(page)).toEqual(["/rɑː/", "/ɹaʊ/"]);

  // The block head names the pronunciation once: the part-of-speech labels
  // underneath carry none of their own.
  await expect(page.getByText("/rɑː/", { exact: true })).toHaveCount(1);
  await expect(page.getByText("/ɹaʊ/", { exact: true })).toHaveCount(1);

  // Every sense still answers, and the two `/ɹaʊ/` ones now sit under their
  // own head rather than either side of the verbs.
  for (const translation of ["remo", "fila", "remar", "pelea", "pelear"]) {
    await expect(page.getByText(translation, { exact: true }).first()).toBeVisible();
  }

  const blocks = page.locator("main [data-pronunciation-block]");
  await expect(blocks.nth(0)).toContainText("remar");
  await expect(blocks.nth(1)).toContainText("pelea");
  await expect(blocks.nth(1)).toContainText("pelear");
  await expect(blocks.nth(1)).not.toContainText("remo");
});

// The exhaustive claim — every one of the 190 headwords carrying more than
// one pronunciation draws each of them in one run — is decided by
// `groupFor` and `pronunciationBlocks`, with no browser in it, and is proved
// over the whole asset in `lib/dictionary/index-build.test.ts`. What is left
// here is what only a browser can answer: what the screen makes of it.

// `can` is one of two headwords (the other is `pace`) whose entry gathers a
// block with no pronunciation to name it: normalising folds the proper noun
// `CAN`, which carries no IPA, into the word. That block is drawn, headless,
// never dropped.
test("RL-51: a sense carrying no IPA still answers, under a block with no head", async ({ page }) => {
  await deleteTranslator(page);
  await loadDictionary(page);
  await answer(page, "can");

  const heads = await blockHeads(page);
  expect(heads.filter((head) => head === "")).toHaveLength(1);
  expect(heads.at(-1)).toBe("");

  await expect(page.getByText("poder", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("lata", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("CAN", { exact: true }).first()).toBeVisible();
});

// RL-47's suffix clause outranks the grouping, and an exact entry still wins
// the top of the screen: neither is touched by RL-51.
test("RL-51 leaves RL-47 standing: `bed` answers as itself and `sternly` still leads with «severo»", async ({
  page,
}) => {
  await deleteTranslator(page);
  await loadDictionary(page);

  await answer(page, "bed");
  await expect(page.getByText("es una forma de", { exact: false })).toHaveCount(0);
  await expect(page.locator("main [data-pronunciation-block]")).toHaveCount(0);

  await answer(page, "sternly");
  await expect(page.getByRole("heading", { name: "stern", exact: true })).toBeVisible();
  const order = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("span, p"));
    const first = nodes.find((node) => node.textContent === "severo");
    const second = nodes.find((node) => node.textContent === "popa");
    if (!first || !second) return null;
    return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
});
