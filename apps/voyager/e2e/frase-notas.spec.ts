import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";

// `search-screen.tsx`'s own constant, not exported: the debounce a sentence
// waits out before it is worth asking about (RNL-05, rule 1). Shared with
// `phrase.spec.ts`'s own copy of the same literal, not imported from it.
const PHRASE_DEBOUNCE_MS = 600;

async function waitForDictionary(page: Page): Promise<void> {
  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);
}

// Chromium's built-in `Translator` hangs `availability()` forever
// (docs/TRAPS.md); deleting it routes every sentence over the network,
// which is the path every test in this file drives.
async function disableDeviceTranslator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

async function stubTranslateRoute(page: Page, answers: Record<string, string>): Promise<void> {
  await page.route("**/api/translate", async (route) => {
    const { text } = route.request().postDataJSON() as { text: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ text: answers[text], origin: "network" }),
    });
  });
}

type NotesAnswer = { notes: Array<{ term: string; note: string }>; delayMs: number };

// A page-level route: Playwright checks it before the context-level one
// `fixtures.ts` installs, so a source sentence here carries its own timed
// answer instead of the fixture's default 204. `x-e2e-word-stub` is the
// same header `fixtures.ts` stamps on its own stub — set here too, so its
// escape watchdog reads this as an answered stub, not a call that reached
// a real paid model.
async function stubNotesRoute(page: Page, answers: Record<string, NotesAnswer>): Promise<{ count: () => number }> {
  let count = 0;
  await page.route("**/api/phrase/notes", async (route) => {
    count++;
    const { source } = route.request().postDataJSON() as { source: string };
    const answer = answers[source];
    if (answer.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, answer.delayMs));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-e2e-word-stub": "1" },
      body: JSON.stringify({ notes: answer.notes }),
    });
  });
  return { count: () => count };
}

test("the translation paints whole before its notes ever answer", async ({ page }) => {
  await disableDeviceTranslator(page);
  const phraseText = "black minorca pullets";
  const answerText = "pollitas negras de menorca";
  const noteBody = "Es una raza de gallina de color negro.";

  await stubTranslateRoute(page, { [phraseText]: answerText });
  await stubNotesRoute(page, {
    [phraseText]: { notes: [{ term: "black minorca", note: noteBody }], delayMs: 1200 },
  });
  await waitForDictionary(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill(phraseText);

  // The translation is already whole...
  await expect(page.getByText(answerText)).toBeVisible({ timeout: 5000 });
  // ...and at this exact point the notes have not answered yet: waiting,
  // not a note in sight.
  await expect(page.getByText(messages.phrase.notesPending)).toBeVisible();
  await expect(page.getByText(messages.phrase.notesTitle)).toHaveCount(0);
  await expect(page.getByText(noteBody)).toHaveCount(0);

  // Only once the delayed answer actually lands does the note appear.
  await page.waitForTimeout(1300);
  await expect(page.getByText(messages.phrase.notesTitle)).toBeVisible();
  await expect(page.getByText("black minorca", { exact: true })).toBeVisible();
  await expect(page.getByText(noteBody)).toBeVisible();
});

test("changing the phrase while its notes are in flight never paints the old phrase's notes", async ({ page }) => {
  await disableDeviceTranslator(page);
  const staleText = "black minorca pullets";
  const staleAnswer = "pollitas negras de menorca";
  const staleNoteBody = "Es una raza de gallina de color negro.";
  const freshText = "frisking from side to side";
  const freshAnswer = "correteando de lado a lado";

  await stubTranslateRoute(page, { [staleText]: staleAnswer, [freshText]: freshAnswer });
  await stubNotesRoute(page, {
    [staleText]: { notes: [{ term: "black minorca", note: staleNoteBody }], delayMs: 1500 },
    [freshText]: { notes: [], delayMs: 0 },
  });
  await waitForDictionary(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill(staleText);
  await expect(page.getByText(staleAnswer)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(messages.phrase.notesPending)).toBeVisible();

  // A fresh sentence, typed while the first phrase's notes are still on
  // their way.
  await searchBox.fill(freshText);
  await expect(page.getByText(freshAnswer)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(messages.phrase.notesTitle)).toHaveCount(0);

  // The stale request is still in flight; give it time to land and prove
  // it never displaces what is already shown.
  await page.waitForTimeout(1700);
  await expect(page.getByText(staleNoteBody)).toHaveCount(0);
  await expect(page.getByText(staleAnswer)).toHaveCount(0);
  await expect(page.getByText(freshAnswer)).toBeVisible();
});

test("a phrase whose notes answer 204 reads exactly as the screen did before RL-46", async ({ page }) => {
  await disableDeviceTranslator(page);
  const phraseText = "we drove to the coast together";
  const answerText = "condujimos juntos hasta la costa";
  await stubTranslateRoute(page, { [phraseText]: answerText });
  // No stubNotesRoute call: `fixtures.ts`'s own default answers
  // `/api/phrase/notes` with 204, the same default every other spec relies
  // on, so this test drives the real fixture path rather than a fake of it.
  await waitForDictionary(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill(phraseText);

  await expect(page.getByText(answerText)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(phraseText)).toBeVisible();
  await expect(page.getByText(messages.phrase.originNetwork)).toBeVisible();

  // Give the notes fetch time to settle before reading its absence: a
  // 204 this fast never has anything to paint either way.
  await page.waitForTimeout(500);
  await expect(page.getByText(messages.phrase.notesTitle)).toHaveCount(0);
  await expect(page.getByText(messages.phrase.notesPending)).toHaveCount(0);
});

test("a keystroke mid-phrase raises no request to /api/phrase/notes", async ({ page }) => {
  await disableDeviceTranslator(page);
  const phraseText = "frisking from side to side";
  const answerText = "correteando de lado a lado";
  await stubTranslateRoute(page, { [phraseText]: answerText });
  // Default 204 from `fixtures.ts` again: this test only counts requests,
  // never their answer.

  let notesRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/phrase/notes")) notesRequests++;
  });

  await waitForDictionary(page);
  const searchBox = page.getByRole("textbox", { name: messages.search.label });

  // One keystroke short of the full phrase, well inside the debounce
  // window: no translation exists yet for anything to note.
  await searchBox.fill(phraseText.slice(0, -1));
  await page.waitForTimeout(PHRASE_DEBOUNCE_MS - 100);
  expect(notesRequests, "no notes request before any translation is even asked for").toBe(0);

  // The keystroke that completes the phrase — still short of the debounce
  // that would let a translation request leave at all.
  await searchBox.fill(phraseText);
  await page.waitForTimeout(PHRASE_DEBOUNCE_MS - 100);
  expect(notesRequests, "the completing keystroke itself raises nothing").toBe(0);

  await expect(page.getByText(answerText)).toBeVisible({ timeout: 5000 });
  // The fixture's default 204 answers fast enough that the pending line can
  // already be gone by the time this reads — the request count below is
  // what this test is actually about, not the pending line's own lifespan.
  await expect
    .poll(() => notesRequests, { message: "the one request leaves only once the translation is already done" })
    .toBe(1);
});
