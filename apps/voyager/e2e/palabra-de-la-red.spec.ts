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

async function openReady(page: Page): Promise<void> {
  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  // The fetch settling is not the worker posting "ready": buildIndex still
  // has to run over 64,258 entries. Give it room before the first keystroke.
  await page.waitForTimeout(1000);
}

// `use-network-answer.ts`'s own debounce (`PHRASE_DEBOUNCE_MS`) plus a
// margin, the same one `word.spec.ts` gives `useDecoration`'s pair.
const NETWORK_SETTLE_MS = 900;

const UNLISTED_ANSWER = {
  translations: ["coccidiosis"],
  definition: "A parasitic disease of the intestine.",
  example: { en: "The flock was tested for coccidiosis.", es: "Se examinó a la parvada por coccidiosis." },
  lemma: null,
  rule: null,
};

// `coccidiosis` (module 5's own cold-miss word): no exact entry, no
// inflection candidate, no headword near enough to correct — the plainest
// of the two shapes this module opens the network for.
test("coccidiosis: the network block draws under the miss line, 200", async ({ page, stubUnlisted }) => {
  await deleteTranslator(page);
  await stubUnlisted(UNLISTED_ANSWER);
  await openReady(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("coccidiosis");

  await expect(page.getByText(messages.search.notFound)).toBeVisible();
  await expect(page.getByText(messages.word.networkAnswerTitle)).toBeVisible({ timeout: NETWORK_SETTLE_MS });
  await expect(page.getByText(UNLISTED_ANSWER.translations[0], { exact: true })).toBeVisible();
  await expect(page.getByText(UNLISTED_ANSWER.definition!)).toBeVisible();
  await expect(page.getByText(UNLISTED_ANSWER.example.en)).toBeVisible();
});

// RL-28's correction offer and RL-44's network answer are two different
// answers to the same miss, and neither replaces the other: `whereat` has a
// real candidate (`whereas`) one edit away, and this module still asks the
// network on its behalf. Ver `## Preguntas`, 1 in the slice plan — this is
// the line that changes if the user decides otherwise, and no other.
test("whereat: the correction offer and the network block draw together", async ({ page, stubUnlisted }) => {
  await deleteTranslator(page);
  await stubUnlisted({ ...UNLISTED_ANSWER, translations: ["¿en dónde?"] });
  await openReady(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("whereat");

  await expect(page.getByText(messages.search.correctionTitle)).toBeVisible();
  await expect(page.getByRole("link", { name: "whereas", exact: false })).toBeVisible();
  await expect(page.getByText(messages.word.networkAnswerTitle)).toBeVisible({ timeout: NETWORK_SETTLE_MS });
});

// A prefix mid-word has no exact hit, no inflected hit and no answer on
// screen to attach a network block to — `suppressNotFound` holds, and
// asking here would charge every paused keystroke a reader never finished.
test("ru: the suggestion list holds, and no request reaches /api/word/unlisted", async ({ page }) => {
  await deleteTranslator(page);
  await openReady(page);

  const requestUrls: string[] = [];
  page.on("request", (request) => requestUrls.push(request.url()));

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("ru");
  await page.waitForTimeout(NETWORK_SETTLE_MS);

  await expect(page.getByText(messages.word.suggestions)).toBeVisible();
  await expect(page.getByText(messages.search.notFound)).toHaveCount(0);
  const unlistedRequests = requestUrls.filter((url) => url.includes("/api/word/unlisted"));
  expect(unlistedRequests, `unexpected /api/word/unlisted requests: ${JSON.stringify(unlistedRequests)}`).toEqual(
    [],
  );
});

// 204 is RL-44's own absence, and the only thing it adds to the miss screen
// is the one line that says the network could not answer either — nothing
// else moves compared to the 200 case above.
test("coccidiosis: 204 draws today's screen plus one line, and nothing else", async ({ page }) => {
  await deleteTranslator(page);
  // No `stubUnlisted` call: the fixture's own default is 204 (module 10's
  // "no key, over a cap, a provider failure" all collapse to this).
  await openReady(page);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("coccidiosis");

  await expect(page.getByText(messages.search.notFound)).toBeVisible();
  await expect(page.getByText(messages.word.networkFailed)).toBeVisible({ timeout: NETWORK_SETTLE_MS });
  await expect(page.getByText(messages.word.networkAnswerTitle)).toHaveCount(0);
  await expect(page.getByText(messages.word.networkTranslations)).toHaveCount(0);
});
