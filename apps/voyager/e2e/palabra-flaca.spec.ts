import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

import messages from "../messages/es.json";

// RL-45: the network's own translations for a thin dictionary answer draw
// under the dictionary's, never inside it — this is the module 8 done
// criterion, proved against `bed` rather than `snuff` so the dictionary
// block under test is the one already read in `palabra-historial.spec.ts`.

// Chromium's built-in `Translator` hangs `availability()` forever
// (docs/TRAPS.md); the word path here must never reach it.
async function deleteTranslator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

// `useDecoration`'s own debounce plus margin: long enough that its text
// request, real or stubbed, has settled by the time this elapses.
const DECORATION_SETTLE_MARGIN_MS = 900;

// `manifest.asset.path` is only ever fetched once per browser context; a
// second `loadBed` in the same test hits the cache and gives no fresh
// `response` event for `waitForResponse` to catch, so this waits for the
// heading itself, generously, instead of for the asset (`palabra-historial
// .spec.ts`'s own `/?q=bed` navigation follows the same pattern).
async function loadBed(page: Page): Promise<void> {
  await page.goto("/?q=bed");
  await expect(page.getByRole("heading", { name: "bed", exact: true })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(DECORATION_SETTLE_MARGIN_MS);
}

// Everything the page drew before `GeneratedText`'s own block — the
// headword row and `SenseGroup`'s senses, translations and IPA — read as one
// string with a DOM `Range` rather than a component boundary, since no file
// this module may touch owns a selector for "the dictionary's block" on its
// own.
async function textBeforeGeneratedBlock(page: Page): Promise<string> {
  return page.evaluate(() => {
    const marker = document.querySelector("[data-generated-block]");
    if (!marker) return document.body.textContent ?? "";
    const range = document.createRange();
    range.setStart(document.body, 0);
    range.setEndBefore(marker);
    return range.toString();
  });
}

// `stubWordText`'s own body type (`fixtures.ts`, out of this module's file
// list) predates RL-45 and does not carry `translations` yet — asserted
// through, never widened, since fixtures.ts is not a file this module edits.
async function stubThinWordText(
  stubWordText: (body: { definition: string | null; example: { en: string; es: string } }) => Promise<void>,
  body: { definition: string | null; example: { en: string; es: string }; translations: string[] | null },
): Promise<void> {
  await stubWordText(body as unknown as { definition: string | null; example: { en: string; es: string } });
}

test("bed's dictionary senses draw unchanged whether the network's translations arrive or not, and the network's own lines sit marked underneath them", async ({
  page,
  stubWordText,
}) => {
  await deleteTranslator(page);

  await stubThinWordText(stubWordText, {
    definition: null,
    example: { en: "He fell asleep in the flower bed.", es: "Se quedó dormido en el macizo de flores." },
    translations: ["aspirar", "resoplar"],
  });

  await loadBed(page);
  const dictionaryWithNetwork = await textBeforeGeneratedBlock(page);

  // The network's own two lines, marked apart from both the dictionary's
  // translations and the generated example above them.
  await expect(page.getByText(messages.word.networkTranslations)).toBeVisible();
  await expect(page.getByText(messages.word.networkMark)).toBeVisible();
  await expect(page.getByText("aspirar", { exact: true })).toBeVisible();
  await expect(page.getByText("resoplar", { exact: true })).toBeVisible();
  await expect(page.locator("[data-network-translations]")).toHaveCount(1);

  await stubThinWordText(stubWordText, {
    definition: null,
    example: { en: "He fell asleep in the flower bed.", es: "Se quedó dormido en el macizo de flores." },
    translations: null,
  });

  await loadBed(page);
  const dictionaryWithoutNetwork = await textBeforeGeneratedBlock(page);

  // The claim this module exists to prove: nothing above the generated
  // block moved a character for `translations` arriving or not.
  expect(dictionaryWithoutNetwork).toBe(dictionaryWithNetwork);

  // `translations: null` draws exactly today's screen — no hairline, no
  // heading, no line gained anywhere in the generated block either.
  await expect(page.locator("[data-network-translations]")).toHaveCount(0);
  await expect(page.getByText(messages.word.networkTranslations)).toHaveCount(0);
  await expect(page.getByText(messages.word.networkMark)).toHaveCount(0);
});

test("a thin word with an empty translations array draws no network block, same as null", async ({
  page,
  stubWordText,
}) => {
  await deleteTranslator(page);

  await stubThinWordText(stubWordText, {
    definition: null,
    example: { en: "He fell asleep in the flower bed.", es: "Se quedó dormido en el macizo de flores." },
    translations: [],
  });

  await loadBed(page);

  await expect(page.locator("[data-network-translations]")).toHaveCount(0);
  await expect(page.getByText(messages.word.networkTranslations)).toHaveCount(0);
});
