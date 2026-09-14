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

// Same patch `speak.spec.ts` uses: records every `speak()`/`cancel()` call
// on the prototype, since Chromium exposes `window.speechSynthesis` as
// accessor-only. Nothing in CI has an audio device, so no utterance runs.
async function captureSpeech(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: { text: string; lang: string }[] = [];
    (window as unknown as { __speakCalls: typeof calls }).__speakCalls = calls;
    const proto = window.SpeechSynthesis.prototype;
    proto.speak = function (utterance: SpeechSynthesisUtterance) {
      calls.push({ text: utterance.text, lang: utterance.lang });
    };
    proto.cancel = function () {};
  });
}

async function gotoReady(page: Page): Promise<void> {
  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  // The fetch settling is not the worker posting "ready": buildIndex still
  // has to run over 64,258 entries. Give it room before the box is used.
  await page.waitForTimeout(1000);
}

// `main`'s own headings, in document order — scoped past `BottomNav`'s own
// heading the same way `sin-entrada.spec.ts` scopes it.
function mainHeadings(page: Page) {
  return page.locator("main").getByRole("heading");
}

async function headingOrder(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("main h1, main h2, main h3"));
    return headings.map((h) => h.textContent ?? "");
  });
}

// RL-47: the form the reader typed leads the answer, and the headword it
// inflects from sits under the 2px rule, named as such. `swishing` has no
// entry of its own — the top of the screen used to answer as `swish`, the
// wrong part of speech for an `-ing`.
test("RL-47: swishing leads with its own form, swish sits under the 2px rule", async ({ page }) => {
  await deleteTranslator(page);
  await gotoReady(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("swishing");

  await expect(page.getByRole("heading", { name: "swishing", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("heading", { name: "swish", exact: true })).toBeVisible();
  await expect(
    page.getByText('"swishing" es una forma de "swish"', { exact: false }),
  ).toBeVisible();

  const order = await headingOrder(page);
  expect(order.indexOf("swishing")).toBeLessThan(order.indexOf("swish"));

  // Each headword carries its own voice control.
  await expect(page.getByRole("button", { name: "Escuchar «swishing»" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Escuchar «swish»" })).toBeVisible();
});

// `left` still answers as `left` first (RL-40's own clause, kept). Its
// offered lemma now also carries a voice control — the one change RL-47
// makes to the branch it does not otherwise touch.
test("RL-47 leaves the exact branch alone but gives its offered lemma a voice control too", async ({
  page,
}) => {
  await deleteTranslator(page);
  await gotoReady(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("left");

  await expect(page.getByRole("heading", { name: "left", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("heading", { name: "leave", exact: true })).toBeVisible();
  await expect(
    page.getByText('"left" también es una forma de "leave"', { exact: false }),
  ).toBeVisible();

  const order = await headingOrder(page);
  expect(order.indexOf("left")).toBeLessThan(order.indexOf("leave"));

  await expect(page.getByRole("button", { name: "Escuchar «left»" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Escuchar «leave»" })).toBeVisible();
});

// RL-47 keeps the `bed` clause: an exact entry the reader typed on purpose
// still wins the top of the screen, and it still offers nothing beneath it
// when every inflection candidate loses (a one-letter lemma, an irregular
// table override).
test("RL-47 keeps the bed clause: bed answers alone, reading still leads over read", async ({ page }) => {
  await deleteTranslator(page);
  await gotoReady(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });

  await searchBox.fill("bed");
  await expect(page.getByRole("heading", { name: "bed", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("es una forma de", { exact: false })).toHaveCount(0);
  await expect(mainHeadings(page)).toHaveCount(1);

  // `reading` carries its own dictionary senses (lectura, leída) and still
  // leads over the `read` it also inflects from — the bed clause RL-47
  // keeps, now with a voice control on both headwords.
  await searchBox.fill("reading");
  await expect(page.getByRole("heading", { name: "reading", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("heading", { name: "read", exact: true })).toBeVisible();
  await expect(page.getByText("lectura", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("leída", { exact: true })).toBeVisible();

  const order = await headingOrder(page);
  expect(order.indexOf("reading")).toBeLessThan(order.indexOf("read"));

  await expect(page.getByRole("button", { name: "Escuchar «reading»" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Escuchar «read»" })).toBeVisible();
});

// RL-26: `snuffed` has no entry of its own — before this module, the lemma
// it drew (`snuff`) carried no voice control at all, because `SpeakButton`
// only ever mounted inside the `exact` branch.
test("RL-26: snuffed's form-only answer gets a voice control, and it fires", async ({ page }) => {
  await deleteTranslator(page);
  await captureSpeech(page);
  await gotoReady(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("snuffed");
  await expect(page.getByRole("heading", { name: "snuffed", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("heading", { name: "snuff", exact: true })).toBeVisible();

  const surfaceButton = page.getByRole("button", { name: "Escuchar «snuffed»" });
  const lemmaButton = page.getByRole("button", { name: "Escuchar «snuff»" });
  await expect(surfaceButton).toBeVisible();
  await expect(lemmaButton).toBeVisible();

  await surfaceButton.click();
  await lemmaButton.click();

  const calls = await page.evaluate(
    () => (window as unknown as { __speakCalls: { text: string; lang: string }[] }).__speakCalls,
  );
  expect(calls).toEqual([
    { text: "snuffed", lang: "en-US" },
    { text: "snuff", lang: "en-US" },
  ]);
});

// The breakdown (`no-entry-answer.tsx`, `variant="compact"`) never draws a
// network block, whichever branch a word falls into: eight words never
// cost eight calls. `swishing` (no entry of its own) and `tails` (an entry
// that also offers `tail`) exercise both branches in one phrase.
test('variant="compact" draws neither branch\'s network block', async ({ page, context }) => {
  await deleteTranslator(page);
  await gotoReady(page);
  await context.setOffline(true);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("swishing tails");

  await expect(page.getByRole("heading", { name: "swishing", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("heading", { name: "swish", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "tails", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "tail", exact: true })).toBeVisible();

  await expect(page.locator("[data-network-answer]")).toHaveCount(0);
  // The breakdown draws no voice control either (RL-26's own clause,
  // unaffected by this module): only the "clear the box" button remains.
  await expect(page.getByRole("button", { name: /^Escuchar/ })).toHaveCount(0);
});

// `fixtures.ts`'s escape watchdog is what proves no request reached the real
// server; this spec adds which routes may be asked at all. A form that only
// resolved through inflection is one of the two cases RL-44 asks the network
// about, so `/api/word/unlisted` is expected here and every other word route
// is not.
test("no real request to /api/word/* is left behind", async ({ page }) => {
  await deleteTranslator(page);
  await gotoReady(page);

  const requestUrls: string[] = [];
  page.on("request", (request) => requestUrls.push(request.url()));

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("swishing");
  await expect(page.getByRole("heading", { name: "swish", exact: true })).toBeVisible({ timeout: 5000 });
  await searchBox.fill("");
  await searchBox.fill("snuffed");
  await expect(page.getByRole("heading", { name: "snuff", exact: true })).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(900);

  const wordRoute = requestUrls.filter((url) => url.includes("/api/word/"));
  const unexpected = wordRoute.filter((url) => !new URL(url).pathname.startsWith("/api/word/unlisted"));
  expect(unexpected, `unexpected /api/word/* requests: ${JSON.stringify(unexpected)}`).toEqual([]);
});
