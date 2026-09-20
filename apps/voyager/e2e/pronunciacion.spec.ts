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

// `word.spec.ts`'s own margin: what the decoration hook needs to resolve
// `/api/word/text` and paint, past the answer the device already drew.
const DECORATION_SETTLE_MARGIN_MS = 900;

async function answer(page: Page, word: string): Promise<void> {
  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill(word);
  await expect(page.getByRole("heading", { name: word, exact: true })).toBeVisible({ timeout: 5000 });
}

// A gloss now lives inside one comma-joined translation line
// (docs/voyager/DESIGN.md "The translations are one line, separated by
// commas"), so it is no longer a text node of its own: this finds it
// bounded by the line's own start, end or comma, never a longer gloss that
// merely contains it (`pelea` inside `pelear`).
function glossLocator(page: Page, gloss: string): Locator {
  const escaped = gloss.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByText(new RegExp(`(^|, )${escaped}(,|$)`));
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
    await expect(glossLocator(page, translation).first()).toBeVisible();
  }

  const blocks = page.locator("main [data-pronunciation-block]");
  await expect(blocks.nth(0)).toContainText("remar");
  await expect(blocks.nth(1)).toContainText("pelea");
  await expect(blocks.nth(1)).toContainText("pelear");
  await expect(blocks.nth(1)).not.toContainText("remo");
});

// docs/voyager/DESIGN.md "The translations are one line, separated by
// commas": `row` draws five senses, each its own comma-joined run, never one
// gloss to a line. `glossLocator`'s presence check above would pass just as
// well against the old one-per-line markup; this is the assertion that
// actually distinguishes the two.
test("`row` draws each sense's translations on one comma-separated line", async ({ page }) => {
  await deleteTranslator(page);
  await loadDictionary(page);
  await answer(page, "row");

  for (const line of [
    "remado, remo",
    "fila, hilera, línea, pista, registro, renglón",
    "pelea, riña, cisco, gresca, pelotera, pifostio, barullo, bulla",
    "remar, bogar, proejar",
    "pelear, discutir, reñir",
  ]) {
    await expect(page.getByText(line, { exact: true })).toBeVisible();
  }
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

  await expect(glossLocator(page, "poder").first()).toBeVisible();
  await expect(glossLocator(page, "lata").first()).toBeVisible();
  await expect(glossLocator(page, "CAN").first()).toBeVisible();
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
  // "severo" now shares its line with the adjective's other glosses, so the
  // match is bounded by the line's own start, end or comma rather than an
  // exact `textContent`.
  const order = await page.evaluate(() => {
    const glossNode = (gloss: string) =>
      Array.from(document.querySelectorAll("span, p")).find((node) =>
        new RegExp(`(^|, )${gloss}(,|$)`).test(node.textContent ?? ""),
      );
    const first = glossNode("severo");
    const second = glossNode("popa");
    if (!first || !second) return null;
    return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
});

// The 19 headwords that used to split on a notation accident. The asset
// writes one sound several ways — `hope` carries `/hoʊp/` and `/ˈhoʊp/`,
// `daisy` `/ˈdeɪzi/` and `/ˈdeɪ.zi/`, `god` `/ɡɑ(d)/` and `/ɡɑd/`, `canton`
// `/ˈkæntɒn/` and `/ˈkænˌtɒn/` — and two
// blocks over them told the reader that two identical sounds differ. Which
// 19 they are is proved over the whole asset in
// `lib/dictionary/index-build.test.ts`; these nine are what the screen is
// driven through. `o` is a tenth and cannot be: `lookupWord` answers no
// one-letter headword but "a" and "i", so `o` draws nothing on any screen,
// RL-51 or not.
test("RL-51: a sound written two ways is one sound — `hope` and its eight kin answer ungrouped", async ({
  page,
}) => {
  await deleteTranslator(page);
  await loadDictionary(page);

  for (const word of ["hope", "daisy", "mass", "ham", "john", "god", "canton", "facebook", "thanksgiving"]) {
    await answer(page, word);
    expect(await blockHeads(page), word).toEqual([]);
  }
});

// The other half of the same rule: only the primary stress is stripped, and
// only at position 0, so a noun stressed on its first syllable and a verb
// stressed on its second stay two words — which is the whole distinction
// RL-51 exists to draw. `english` carries the same shape; `row` and its kin
// are two sounds outright.
test("RL-51: `imprint` and its eight kin still answer as two blocks", async ({ page }) => {
  await deleteTranslator(page);
  await loadDictionary(page);

  for (const word of ["imprint", "invite", "mandate", "koine", "english", "row", "tear", "bass", "lead"]) {
    await answer(page, word);
    expect((await blockHeads(page)).length, word).toBe(2);
  }
});

// RL-26 beside RL-51: `lib/speech/speak.ts` is handed the spelling, so the
// browser picks one of `row`'s two sounds and the control used to claim both
// and name neither.
test("RL-51: the voice control names the pronunciation it speaks", async ({ page }) => {
  await deleteTranslator(page);
  await loadDictionary(page);
  await answer(page, "row");

  const named = messages.word.listenPronunciation.replace("{headword}", "row").replace("{ipa}", "/rɑː/");
  await expect(page.getByRole("button", { name: named, exact: true })).toBeVisible();

  // An entry with one pronunciation names nothing extra: there is no second
  // sound for the reader to have it confused with.
  await answer(page, "umbrella");
  const plain = messages.word.listen.replace("{headword}", "umbrella");
  await expect(page.getByRole("button", { name: plain, exact: true })).toBeVisible();
});

// RL-42's example is decoration resolved from the spelling alone, drawn
// after the last block, and on a grouped entry it read as that block's own:
// `row` closed with «Me gusta remar el bote» under /ɹaʊ/, the fight. The
// foot line names the pronunciation the example is about.
test("RL-51: the generated example names the block it belongs to, and only on a grouped entry", async ({
  page,
  stubWordText,
}) => {
  await deleteTranslator(page);
  await stubWordText({
    definition: null,
    example: { en: "I like to row the boat.", es: "Me gusta remar el bote." },
  });
  await loadDictionary(page);

  await answer(page, "row");
  await page.waitForTimeout(DECORATION_SETTLE_MARGIN_MS);
  await expect(page.getByText("Me gusta remar el bote.")).toBeVisible();
  const named = messages.word.examplePronunciation.replace("{ipa}", "/rɑː/");
  await expect(page.getByText(named, { exact: true })).toBeVisible();

  // The line sits under the example, not over it: it answers the block the
  // example was drawn beneath.
  const belowExample = await page.evaluate(() => {
    const line = document.querySelector("main [data-generated-pronunciation]");
    const block = document.querySelector("main [data-generated-block]");
    if (!line || !block) return null;
    return Boolean(block.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(belowExample).toBe(true);

  // An entry that draws no block gains nothing: there is no second
  // pronunciation the example could have been read as.
  await answer(page, "umbrella");
  await page.waitForTimeout(DECORATION_SETTLE_MARGIN_MS);
  await expect(page.getByText("Me gusta remar el bote.")).toBeVisible();
  await expect(page.locator("main [data-generated-pronunciation]")).toHaveCount(0);
});

// The breakdown of a phrase the dictionary cannot answer carries
// translations alone (docs/voyager/DESIGN.md "A word block on
// `SinEntradaFrase`"), so it never groups and never draws an IPA. Every
// phrase the other specs drive happens to hold no multi-pronunciation word,
// which left `compact` guarding this by accident of vocabulary: `row` and
// `tear` are what really test it.
test("RL-51: the no-entry breakdown never groups — `row` inside a phrase draws no block and no IPA", async ({
  page,
}) => {
  await deleteTranslator(page);
  await page.route("**/api/translate", async (route) => {
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "provider" }) });
  });
  await loadDictionary(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("row zzqx");
  await expect(page.getByRole("heading", { name: "row", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(messages.search.noEntry.wordMiss)).toBeVisible();

  // The word really is in the breakdown, with the senses that would have
  // grouped on the word screen.
  await expect(glossLocator(page, "remo").first()).toBeVisible();
  await expect(glossLocator(page, "pelea").first()).toBeVisible();

  await expect(page.locator("main [data-pronunciation-block]")).toHaveCount(0);
  await expect(page.getByText("/rɑː/", { exact: true })).toHaveCount(0);
  await expect(page.getByText("/ɹaʊ/", { exact: true })).toHaveCount(0);
});

// The same principle one level down: a sense keeps its own IPA line only
// where it is a different *sound* from its label row's, not a different
// spelling. `mass` drew `/ˈmæs/` over its noun row and `/mæs/` again on the
// second sense under it; `god` and `majesty` carried the same dead line.
test("RL-51: a sense draws no IPA line of its own where the sound is the one already named", async ({
  page,
}) => {
  await deleteTranslator(page);
  await loadDictionary(page);
  await answer(page, "mass");

  // `mass` draws three label rows — adjective, noun, verb — and the asset
  // writes the noun's stress and the other two without it. One line each,
  // and no fourth repeating the noun's sound inside a sense.
  await expect(page.getByText("/mæs/", { exact: true })).toHaveCount(2);
  await expect(page.getByText("/ˈmæs/", { exact: true })).toHaveCount(1);
});
