import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";
import type { WorkerRequest, WorkerResponse } from "../lib/dictionary/worker-protocol";
import { PHRASE_DEBOUNCE_MS } from "../lib/query/settle";

// CI's `voyager-e2e` job and a lane started with `VOYAGER_BASE_URL` both
// need this test's own route interception scoped to the app's real origin,
// never to any host a stray absolute URL might carry.
const baseURL = process.env.VOYAGER_BASE_URL ?? "http://localhost:3100";

// Chromium's built-in `Translator` hangs `availability()` forever
// (docs/TRAPS.md); the mount effect must never reach it in this suite.
async function deleteTranslator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

// `useDecoration`'s own debounce (`PHRASE_DEBOUNCE_MS`) plus margin: long
// enough that its pair of requests has fired and resolved by the time this
// elapses.
const DECORATION_SETTLE_MARGIN_MS = 900;

// Exposes the one `Worker` the hook creates as `window.__dictionaryWorker`,
// so a test can drive it directly and measure the round trip RNL-01 governs
// — the message posted to the answer received — with nothing of React's own
// render or commit inside the number.
async function exposeDictionaryWorker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    class CapturingWorker extends NativeWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        (window as unknown as { __dictionaryWorker?: Worker }).__dictionaryWorker = this;
      }
    }
    window.Worker = CapturingWorker as unknown as typeof Worker;
  });
}

// The pause these tests hold past a keystroke before checking the offer:
// long enough that the old, retired withdrawal timer would have fired.
// RL-18 withdraws on the answer, never on a timer, so this constant is the
// tests' own clock — long enough to prove no timer fires — not the
// component's.
const SUGGESTIONS_SETTLE_MS = 900;

type WorkerRequestShape = Extract<WorkerRequest, { kind: "lookup" }>;
// The one response kind this probe listens for; `status` carries no `id`
// and every other kind belongs to the hook's own outstanding requests.
type WorkerResponseShape = Extract<WorkerResponse, { kind: "answer" }> | { id?: number; kind: string };

// Ids well past anything `useDictionary`'s own counter reaches during one
// page life, so a reply to one of these can never be claimed by the hook's
// resolver map, and a reply to the hook's own requests can never satisfy
// this loop.
let nextProbeId = 10_000_000;

async function measureWorkerRoundTrips(page: Page, count: number, text: string): Promise<number[]> {
  return page.evaluate(
    async ({ count, text, startId }) => {
      const worker = (window as unknown as { __dictionaryWorker: Worker }).__dictionaryWorker;
      const durations: number[] = [];
      for (let i = 0; i < count; i++) {
        const id = startId + i;
        const start = performance.now();
        await new Promise<void>((resolve) => {
          const onMessage = (event: MessageEvent<WorkerResponseShape>) => {
            if (event.data.id !== id || event.data.kind !== "answer") return;
            worker.removeEventListener("message", onMessage);
            durations.push(performance.now() - start);
            resolve();
          };
          worker.addEventListener("message", onMessage);
          worker.postMessage({ id, kind: "lookup", text } satisfies WorkerRequestShape);
        });
      }
      return durations;
    },
    { count, text, startId: (nextProbeId += count * 2) - count * 2 },
  );
}

function percentile(durations: readonly number[], p: number): number {
  const sorted = [...durations].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

// Drives `suggest()` through the worker directly, past `exposeDictionaryWorker`,
// so the measured list is the same one `suggest.ts` builds for the running
// screen — not a re-implementation of its filter in the test file.
async function askWorkerToSuggest(page: Page, prefix: string, limit: number): Promise<string[]> {
  const id = nextProbeId++;
  return page.evaluate(
    async ({ id, prefix, limit }) => {
      const worker = (window as unknown as { __dictionaryWorker: Worker }).__dictionaryWorker;
      return new Promise<string[]>((resolve) => {
        const onMessage = (event: MessageEvent<{ id?: number; kind: string; items?: string[] }>) => {
          if (event.data.id !== id || event.data.kind !== "suggestions") return;
          worker.removeEventListener("message", onMessage);
          resolve(event.data.items ?? []);
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage({ id, kind: "suggest", prefix, limit });
      });
    },
    { id, prefix, limit },
  );
}

test("an installed dictionary answers offline, fast, and within a thumb's reach", async ({ page, context }) => {
  await deleteTranslator(page);
  await exposeDictionaryWorker(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  // The fetch settling is not the worker posting "ready": buildIndex still
  // has to run over 64,258 entries. Give it room before cutting the network.
  await page.waitForTimeout(1000);
  await context.setOffline(true);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });

  await searchBox.fill("throughout");
  await expect(page.getByRole("heading", { name: "throughout" })).toBeVisible({ timeout: 5000 });

  // `left` is its own headword, so it answers first — RL-40 offers `leave`
  // beneath it, never in its place (`PalabraConFlexion`, `lookup.ts`).
  await searchBox.fill("left");
  await expect(page.getByRole("heading", { name: "left" })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("heading", { name: "leave" })).toBeVisible();

  const durations = await measureWorkerRoundTrips(page, 200, "throughout");
  expect(durations).toHaveLength(200);
  const p95 = percentile(durations, 95);
  console.log(`RNL-01 worker round trip, 200 lookups, log empty — p95 ${p95.toFixed(3)} ms`);
  expect(p95).toBeLessThan(10);

  // RNL-03: no horizontal overflow, and every focusable control clears the
  // 32px floor on its shorter side, at the 360px viewport this project runs.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(360);

  const undersized = await page.evaluate(() => {
    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex]:not([tabindex="-1"])'),
    );
    return focusable
      .filter((el) => el.checkVisibility())
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { tag: el.tagName, shorter: Math.min(rect.width, rect.height) };
      })
      .filter((entry) => entry.shorter < 32);
  });
  expect(undersized).toEqual([]);
});

test("RL-18: the offer retires the moment an answer stands under it", async ({ page }) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  const suggestionsLabel = page.getByText(messages.word.suggestions);
  const heading = page.getByRole("heading", { name: "throughout" });

  await searchBox.fill("throughout");

  // RNL-05: the answer lands on the keystroke, and it is the answer — not a
  // timer — that takes the offer away.
  await expect(heading).toBeVisible({ timeout: SUGGESTIONS_SETTLE_MS - 400 });
  await expect(suggestionsLabel).toHaveCount(0);

  await page.waitForTimeout(SUGGESTIONS_SETTLE_MS + 200);
  await expect(suggestionsLabel).toHaveCount(0);
  await expect(heading).toBeVisible();

  // Cut back to a prefix that answers nothing and the offer returns, and
  // stays — this is the pause that used to leave the page blank.
  await searchBox.fill("throughou");
  await expect(suggestionsLabel).toBeVisible();
  await page.waitForTimeout(SUGGESTIONS_SETTLE_MS + 200);
  await expect(suggestionsLabel).toBeVisible();
});

test("a mid-word prefix stays silent past the settle, and a real miss still says so", async ({ page }) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  const notFound = page.getByText(messages.search.notFound);

  // "ru" is not a headword on its own, but it prefixes real ones ("run",
  // "rub"...): the offer stays up past the settle, and the miss text stays
  // out regardless — the suppression reads the suggestion data, not
  // whether the list is still on screen.
  await searchBox.fill("ru");
  await page.waitForTimeout(SUGGESTIONS_SETTLE_MS + 200);
  await expect(page.getByText(messages.word.suggestions)).toBeVisible();
  await expect(notFound).toHaveCount(0);

  // A string past every real headword — no suppression left to hide behind.
  await searchBox.fill("zzqx");
  await page.waitForTimeout(SUGGESTIONS_SETTLE_MS + 200);
  await expect(notFound).toBeVisible();

  // Finishing the word answers as always, past any suppression.
  await searchBox.fill("run");
  await expect(page.getByRole("heading", { name: "run" })).toBeVisible({ timeout: 5000 });
  await expect(notFound).toHaveCount(0);
});

test("RNL-03: an 85-character headword with no space to break on never scrolls the page sideways", async ({
  page,
}) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  // The dictionary's own longest headword, no space anywhere in it, paired
  // with the longest IPA it carries — the exact case that broke the page.
  const headword = "Taumatawhakatangihangakoauauotamateaturipukakapikimaungahoronukupokaiwhenuakitanatahu";
  await searchBox.fill(headword);
  await expect(page.getByRole("heading", { name: headword })).toBeVisible({ timeout: 5000 });

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBe(clientWidth);
});

test("a paused prefix never leaves the page blank", async ({ page }) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });

  // "ru" answers nothing on its own — the old withdrawal timer left this
  // exact pause with nothing at all on screen.
  await searchBox.fill("ru");
  await page.waitForTimeout(1500);
  const textLength = await page.evaluate(() => document.querySelector("main")?.innerText.length ?? 0);
  expect(textLength).toBeGreaterThan(0);
});

// Counts definition blocks (docs/voyager/DESIGN.md "The English definition
// draws open, always") bounded by document order to two headings — never
// the whole page — so a second headword's own senses (an inflected form's
// `viaInflection` group) never inflate the count of the one being measured.
async function countDefinitionsBetween(
  page: Page,
  afterHeading: string,
  beforeHeading: string | null,
  label: string,
): Promise<number> {
  return page.evaluate(
    ({ afterHeading, beforeHeading, label }) => {
      const headings = Array.from(document.querySelectorAll("h1"));
      const after = headings.find((h) => h.textContent === afterHeading);
      const before = beforeHeading ? headings.find((h) => h.textContent === beforeHeading) : undefined;
      if (!after) return -1;
      return Array.from(document.querySelectorAll("[data-definition-block]"))
        .filter((b) => b.textContent?.includes(label))
        .filter((b) => Boolean(after.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING))
        .filter((b) => !before || Boolean(b.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_FOLLOWING))
        .length;
    },
    { afterHeading, beforeHeading, label },
  );
}

test("a headword with no definition at all draws no definition label and no dangling line", async ({ page }) => {
  await deleteTranslator(page);
  // `./fixtures`'s own default already answers 204 on the text route (the
  // daily cap reached, no key, or a provider failure): no dictionary label,
  // and — this is the claim the slice adds — no generated one either.

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  // "umbrella": one sense, no definition in the source, and no inflection
  // candidate the dictionary carries — nothing on the page but its own
  // headword and translations.
  await searchBox.fill("umbrella");
  await expect(page.getByRole("heading", { name: "umbrella", exact: true })).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(DECORATION_SETTLE_MARGIN_MS);

  await expect(page.getByText(messages.word.definitionEnglish)).toHaveCount(0);
  await expect(page.getByText(messages.word.definitionGenerated)).toHaveCount(0);
});

test("umbrella draws no dictionary definition, and the generated one arrives marked", async ({
  page,
  stubWordText,
}) => {
  await deleteTranslator(page);
  // The text route answers as if the model had generated one, still fully
  // mocked.
  await stubWordText({
    definition: "A device used for protection against rain, consisting of a folding frame.",
    example: { en: "She opened her umbrella as it started to rain.", es: "Abrió su paraguas cuando empezó a llover." },
  });

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("umbrella");
  await expect(page.getByRole("heading", { name: "umbrella", exact: true })).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(DECORATION_SETTLE_MARGIN_MS);

  // Still no dictionary label — umbrella's own source entry has none — but
  // now the generated block, carrying its «generada» mark.
  await expect(page.getByText(messages.word.definitionEnglish)).toHaveCount(0);
  await expect(page.getByText(messages.word.definitionGenerated)).toBeVisible();
  await expect(page.getByText(messages.word.generatedMark)).toBeVisible();
});

test("a generated example with no definition heads itself as an example, never as a definition", async ({
  page,
  stubWordText,
}) => {
  await deleteTranslator(page);
  // The route answers `definition: null` whenever the dictionary already
  // carries one, not only for the 19.7% missing outright
  // (`app/api/word/text/route.ts`) — «Definición generada» must not stand
  // over an example alone either way.
  await stubWordText({
    definition: null,
    example: {
      en: "She opened her umbrella as it started to rain.",
      es: "Abrió su paraguas cuando empezó a llover.",
    },
  });

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("umbrella");
  await expect(page.getByRole("heading", { name: "umbrella", exact: true })).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(DECORATION_SETTLE_MARGIN_MS);

  // No definition heading of either kind, the example headed by its own
  // label instead, and the «generada» mark still on it.
  await expect(page.getByText(messages.word.definitionEnglish)).toHaveCount(0);
  await expect(page.getByText(messages.word.definitionGenerated)).toHaveCount(0);
  await expect(page.getByText(messages.word.example, { exact: true })).toBeVisible();
  await expect(page.getByText(messages.word.generatedMark)).toBeVisible();
  await expect(page.getByText("She opened her umbrella as it started to rain.")).toBeVisible();
});

test("`left` (one of the 34 entries whose definition is a bare '.') never draws that period as one", async ({
  page,
}) => {
  await deleteTranslator(page);
  // `left` has its own dictionary definitions; stubbing the text route to
  // 204 leaves the count below the dictionary's own, unmoved by decoration.
  // Module 7 keeps the generated label ("Definición generada") apart from
  // the dictionary's own ("Definición en inglés"); if this ever moves off
  // 2, the two strings collided.

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("left");
  await expect(page.getByRole("heading", { name: "left", exact: true })).toBeVisible({ timeout: 5000 });
  // RL-40 offers `leave` beneath `left`'s own entry — its own senses carry
  // no definition at all, so bounding the count to `left`'s own block below
  // proves the period-only filter without depending on that separately.
  await expect(page.getByRole("heading", { name: "leave", exact: true })).toBeVisible();
  await page.waitForTimeout(DECORATION_SETTLE_MARGIN_MS);

  // Four senses of "left" carry a definition in the source: adj (null,
  // never had one), adv ("On the left side."), n ("The left side or
  // direction.") and v ("."). Only the two real ones draw; the bare period
  // is filtered to no definition, same as adj's null.
  const definitions = await countDefinitionsBetween(page, "left", "leave", messages.word.definitionEnglish);
  expect(definitions).toBe(2);
});

test("the English definition draws open with no interaction, and stays inside the column", async ({ page }) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("her");
  await expect(page.getByRole("heading", { name: "her", exact: true })).toBeVisible({ timeout: 5000 });

  const englishText = "The form of she used after a preposition, as the object of a verb";

  // Open on arrival, nothing tapped: the label and its prose both show.
  await expect(page.getByText(messages.word.definitionEnglish).first()).toBeVisible();
  await expect(page.getByText(englishText)).toBeVisible();

  // 360px, open: the prose fits inside the column with no horizontal spill.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

// `bed` is a headword the dictionary carries. It also matched two false
// inflection candidates — "a form of `b`", a bare single-letter lemma
// `lookupWord` never answers on its own, and "a form of `be`", a regular
// `-ed` guess the irregular table overrides (`be`'s real past is
// `was`/`were`, never `bed`). Neither ships, with or without `bed`'s own
// entry standing above them.
test("a word the dictionary carries never offers a one-letter lemma or an irregular table override", async ({
  page,
}) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });

  await searchBox.fill("bed");
  await expect(page.getByRole("heading", { name: "bed" })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('es una forma de', { exact: false })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "b", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "be", exact: true })).toHaveCount(0);

  // `running` is its own entry too, and still offers `run` beneath it — the
  // `-ing` family has no irregular past-tense entry to lose to, so the
  // filter that blocks `be` never touches it.
  await searchBox.fill("running");
  await expect(page.getByRole("heading", { name: "run", exact: true })).toBeVisible({ timeout: 5000 });
});

// The index carries a one-letter key for 12 stripped abbreviations, suffix
// lists and bare letter-names besides the two real headwords, `a` and `i`
// (`I` normalises to it). `lookup.ts` answers only the two; everything else
// a single keystroke reaches now falls through to the same silence a
// mid-word prefix already draws.
test("a one-character query answers only `a` and `i`, never the other ten single-letter keys", async ({
  page,
}) => {
  await deleteTranslator(page);
  await exposeDictionaryWorker(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  const suggestionsLabel = page.getByText(messages.word.suggestions);
  const notFound = page.getByText(messages.search.notFound);

  // "b" is not answerable: no heading, no "not found" (a suggestion list
  // stands in for it, same as any other unmatched prefix), suggestions only.
  await searchBox.fill("b");
  await page.waitForTimeout(SUGGESTIONS_SETTLE_MS + 200);
  await expect(page.getByRole("heading", { name: "b", exact: true })).toHaveCount(0);
  await expect(notFound).toHaveCount(0);
  await expect(suggestionsLabel).toBeVisible();

  // "a" is one of the two: its own entry answers, translations included.
  await searchBox.fill("a");
  await expect(page.getByRole("heading", { name: "a", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("una", { exact: true })).toBeVisible();
  await expect(suggestionsLabel).toHaveCount(0);

  // "I" is the other: it normalises to "i" and answers with "yo".
  await searchBox.fill("I");
  await expect(page.getByRole("heading", { name: "i", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("yo", { exact: true })).toBeVisible();

  // Two or more characters are untouched: `be` and `bed` answer as before.
  await searchBox.fill("be");
  await expect(page.getByRole("heading", { name: "be", exact: true })).toBeVisible({ timeout: 5000 });
  await searchBox.fill("bed");
  await expect(page.getByRole("heading", { name: "bed", exact: true })).toBeVisible({ timeout: 5000 });

  // The suggestion list itself: "b" no longer offers itself, "a" still does.
  const bSuggestions = await askWorkerToSuggest(page, "b", 10);
  expect(bSuggestions).not.toContain("b");
  const aSuggestions = await askWorkerToSuggest(page, "a", 10);
  expect(aSuggestions).toContain("a");
});

// RL-40, board `PalabraConFlexion`: a word that is itself a headword answers
// first, and a lemma it also inflects from is offered beneath it, never in
// its place. `left` carries both — its own entry and the offer of `leave`.
// `bed` carries only the first: its two false candidates, "b" (a one-letter
// lemma) and "be" (a regular guess the irregular table overrides), earn no
// offer at all.
test("RL-40: a word's own entry answers first, and a plausible inflection is offered beneath it", async ({
  page,
}) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });

  await searchBox.fill("left");
  const leftHeading = page.getByRole("heading", { name: "left", exact: true });
  const leaveHeading = page.getByRole("heading", { name: "leave", exact: true });
  await expect(leftHeading).toBeVisible({ timeout: 5000 });
  // The own entry's own senses, above any offer.
  await expect(page.getByText("izquierda", { exact: true }).first()).toBeVisible();
  // The offer's own label and heading, naming both the surface and the
  // lemma it also inflects from.
  await expect(page.getByText('"left" también es una forma de "leave"', { exact: false })).toBeVisible();
  await expect(leaveHeading).toBeVisible();
  await expect(page.getByText("dejar", { exact: true }).first()).toBeVisible();
  // `left`'s own entry sits above the offer in document order — it answers
  // first, the offer never replaces it.
  const order = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("h1"));
    const left = headings.find((h) => h.textContent === "left");
    const leave = headings.find((h) => h.textContent === "leave");
    if (!left || !leave) return null;
    return Boolean(left.compareDocumentPosition(leave) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);

  await searchBox.fill("bed");
  await expect(page.getByRole("heading", { name: "bed", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("también es una forma de", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "b", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "be", exact: true })).toHaveCount(0);
});

// Long enough that "cat"'s answer, sent second, still lands well inside it
// — long enough to still be in flight when "cat" replaces "dog" below.
const SLOW_ANSWER_DELAY_MS = 3000;

const DOG_TEXT = {
  definition: "Definición de dog: nunca debe aparecer bajo cat.",
  example: { en: "The dog barks loudly.", es: "El perro ladra fuerte." },
};
const CAT_TEXT = {
  definition: "Definición de cat.",
  example: { en: "The cat sleeps all day.", es: "El gato duerme todo el día." },
};

test("a headword replaced mid-flight never lands its text on the word that replaced it", async ({
  page,
  allowRealWordRoute,
}) => {
  await deleteTranslator(page);
  // Headword-specific bodies and delays, wired by this test alone — the
  // default stub answers the same body for every headword, which cannot
  // tell "dog's answer" from "cat's answer" apart.
  await allowRealWordRoute("text", "this spec answers per headword itself, below, never the real route");

  await page.route(`${baseURL}/api/word/text`, async (route) => {
    const body = route.request().postDataJSON() as { headword: string };
    const isDog = body.headword === "dog";
    if (isDog) {
      // Long enough to still be in flight when "cat" replaces it below.
      await new Promise((resolve) => setTimeout(resolve, SLOW_ANSWER_DELAY_MS));
    }
    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(isDog ? DOG_TEXT : CAT_TEXT),
      });
    } catch {
      // `dog`'s own AbortController already cancelled the fetch client-side
      // by the time this fires; there is nothing left to answer.
    }
  });

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("dog");
  await expect(page.getByRole("heading", { name: "dog", exact: true })).toBeVisible({ timeout: 5000 });

  // Past the debounce, so `dog`'s own fetch has actually been sent — the
  // abort this proves is one of an in-flight request, not one still only
  // queued behind the timer.
  await page.waitForTimeout(PHRASE_DEBOUNCE_MS + 300);

  await searchBox.fill("cat");
  await expect(page.getByRole("heading", { name: "cat", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(CAT_TEXT.example.en)).toBeVisible({ timeout: PHRASE_DEBOUNCE_MS + 2000 });

  // Long enough that `dog`'s slow answer, had it not been abandoned, would
  // already have landed.
  await page.waitForTimeout(SLOW_ANSWER_DELAY_MS);
  await expect(page.getByText(CAT_TEXT.example.en)).toBeVisible();
  await expect(page.getByText(DOG_TEXT.example.en)).toHaveCount(0);
});

// RL-51 groups only the 105 headwords carrying more than one pronunciation.
// `leave` carries one, so it is the control: RL-43's own example, the order
// no fixed rank can give — «dejar» before «permiso» — drawn with no block
// head and with the IPA still on each part-of-speech label row.
test("RL-51: a headword with one pronunciation draws no block, and keeps its IPA on the label row", async ({
  page,
}) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("leave");
  await expect(page.getByRole("heading", { name: "leave", exact: true })).toBeVisible({ timeout: 5000 });

  await expect(page.locator("main [data-pronunciation-block]")).toHaveCount(0);

  // One IPA per label row, both of them: what a block head would have
  // replaced with a single line above the two.
  await expect(page.getByText("/liv/", { exact: true })).toHaveCount(2);

  const order = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll("main span"))
      .map((node) => node.textContent)
      .filter((text) => text === "verbo" || text === "sustantivo");
    return labels;
  });
  expect(order).toEqual(["verbo", "sustantivo"]);
});
