import { expect, test } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";
import type { LookupOutcome } from "../lib/log/types";

// The module 12 done criterion: `/registro/<normalised>` lists every search
// for one word, most recent first, and never bleeds a different word in.

// Chromium's built-in `Translator` hangs `availability()` forever
// (docs/TRAPS.md); the word path here must never reach it.
async function deleteTranslator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

async function deleteLogDatabase(page: Page): Promise<void> {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase("reading-log");
  });
}

// Exposes every `Worker` construction as `window.__workersBuilt`, mirroring
// `export.spec.ts`'s own helper — RNL-08 holds here too.
async function countWorkerConstructions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __workersBuilt: number }).__workersBuilt = 0;
    const NativeWorker = window.Worker;
    class CountingWorker extends NativeWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        (window as unknown as { __workersBuilt: number }).__workersBuilt += 1;
      }
    }
    window.Worker = CountingWorker as unknown as typeof Worker;
  });
}

type SeedRow = {
  at: number;
  text: string;
  normalised: string;
  translation: string | null;
  outcome?: LookupOutcome;
  // "word" unless said otherwise: every seeded row until RL-34 was one.
  kind?: "word" | "phrase";
  // Set on a row standing in for one another device already merged in
  // (`merge.ts`'s own shape); absent on a row this "device" wrote itself.
  device?: string;
  deviceSeq?: number;
};

async function seedRows(page: Page, rows: SeedRow[]): Promise<void> {
  await page.evaluate(
    (rows) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("reading-log");
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore("lookups", { keyPath: "id", autoIncrement: true });
          store.createIndex("at", "at");
          store.createIndex("normalised", "normalised");
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("lookups", "readwrite");
          const store = tx.objectStore("lookups");
          for (const row of rows) {
            const kind = row.kind ?? "word";
            const record: Record<string, unknown> = {
              schema: 2,
              at: row.at,
              text: row.text,
              normalised: row.normalised,
              kind,
              outcome: row.outcome ?? "exact",
              headword: kind === "word" ? row.text : null,
              rule: null,
              senses: kind === "word" ? 1 : 0,
              translation: row.translation,
              dictionaryReady: true,
              origin: kind === "phrase" ? "network" : null,
            };
            // Only a foreign row names a device, matching `record.ts`'s own
            // `foreign` index: a local row carries neither key at all.
            if (row.device !== undefined) record.device = row.device;
            if (row.deviceSeq !== undefined) record.deviceSeq = row.deviceSeq;
            store.add(record);
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
    rows,
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

// A dictionary gloss shares its line with the rest of its sense's
// translations (docs/voyager/DESIGN.md "The translations are one line,
// separated by commas"), so it is no longer a text node of its own: this
// finds it bounded by the line's own start, end or `, `, never a longer
// gloss that merely contains it. A phrase's own stored `translation`
// (`kind: "phrase"`) is never joined with anything else and needs no such
// bound, so those assertions below stay on plain `getByText`.
function glossLocator(page: Page, gloss: string): Locator {
  const escaped = gloss.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByText(new RegExp(`(^|, )${escaped}(,|$)`));
}

test("a word's history lists every one of its searches with its date, and no other word leaks in", async ({
  page,
}) => {
  await deleteTranslator(page);
  // No `deleteLogDatabase` here: it is an init script, so it would also fire
  // on the `/registro/lukewarm` navigation below and erase the rows just
  // seeded. A fresh Playwright context already starts with no database.
  await countWorkerConstructions(page);

  const now = Date.now();
  await page.goto("/registro");
  await seedRows(page, [
    { at: now - 3 * DAY_MS, text: "lukewarm", normalised: "lukewarm", translation: "tibio" },
    { at: now - 2 * DAY_MS, text: "lukewarm", normalised: "lukewarm", translation: "tibio" },
    { at: now - 1 * DAY_MS, text: "lukewarm", normalised: "lukewarm", translation: "tibio" },
    { at: now - 5 * DAY_MS, text: "Word", normalised: "word", translation: "palabra" },
  ]);

  await page.goto("/registro/lukewarm");
  await expect(page.getByRole("heading", { name: "lukewarm" })).toBeVisible();
  await expect(page.getByText(/3 búsquedas/)).toBeVisible();

  // Three rows: one `Exacta` label per search, none of them the other word's.
  await expect(page.getByText(messages.log.outcome.exact, { exact: true })).toHaveCount(3);
  await expect(page.getByText("Word", { exact: true })).toHaveCount(0);
  await expect(page.getByText("palabra", { exact: true })).toHaveCount(0);

  // This screen answers with the dictionary too now: exactly one Worker,
  // the same single mount the search box gets — never one per row rendered.
  const workers = await page.evaluate(() => (window as unknown as { __workersBuilt: number }).__workersBuilt);
  expect(workers).toBe(1);

  await page.goto("/registro/word");
  await expect(page.getByRole("heading", { name: "Word" })).toBeVisible();
  await expect(page.getByText(messages.log.outcome.exact, { exact: true })).toHaveCount(1);
});

// RL-32's other half, `readWordHistory`, filters `lookups` on `normalised`
// alone: a foreign row (`device`/`deviceSeq` set, `merge.ts`'s own shape)
// sits in the same store as a local one and the reader never sees the
// difference — the screen just orders every row by its own `at`. Seeded
// out of both `at` order and insertion order, so a bug that sorted by
// insertion (autoincrement `id`) or grouped by device would show a
// different order than this test expects.
test("a word's history interleaves two devices' rows by their own `at`, not by device or insertion order", async ({
  page,
}) => {
  await deleteTranslator(page);

  const now = Date.now();
  await page.goto("/registro");
  await seedRows(page, [
    // id 1, at -3d, local
    { at: now - 3 * DAY_MS, text: "twilight", normalised: "twilight", translation: "crepúsculo", outcome: "inflected" },
    // id 2, at -1d, foreign (device-a)
    {
      at: now - 1 * DAY_MS,
      text: "twilight",
      normalised: "twilight",
      translation: "crepúsculo",
      outcome: "exact",
      device: "device-a",
      deviceSeq: 1,
    },
    // id 3, at -4d, local
    { at: now - 4 * DAY_MS, text: "twilight", normalised: "twilight", translation: "crepúsculo", outcome: "miss" },
    // id 4, at -2d, foreign (device-b)
    {
      at: now - 2 * DAY_MS,
      text: "twilight",
      normalised: "twilight",
      translation: "crepúsculo",
      outcome: "translated",
      device: "device-b",
      deviceSeq: 1,
    },
  ]);

  await page.goto("/registro/twilight");
  await expect(page.getByRole("heading", { name: "twilight" })).toBeVisible();
  await expect(page.getByText(/4 búsquedas/)).toBeVisible();

  // Document order of the four outcome labels: most recent `at` first,
  // regardless of which device wrote the row or when it was inserted.
  const labelPattern = new RegExp(
    [
      messages.log.outcome.exact,
      messages.log.outcome.translated,
      messages.log.outcome.inflected,
      messages.log.outcome.miss,
    ].join("|"),
  );
  const rendered = await page.getByText(labelPattern).allTextContents();
  expect(rendered).toEqual([
    messages.log.outcome.exact, // -1d, foreign, id 2
    messages.log.outcome.translated, // -2d, foreign, id 4
    messages.log.outcome.inflected, // -3d, local, id 1
    messages.log.outcome.miss, // -4d, local, id 3
  ]);
});

test("from /registro, tapping the lukewarm row reaches /registro/lukewarm", async ({ page }) => {
  await deleteTranslator(page);

  await page.goto("/registro");
  await seedRows(page, [{ at: Date.now(), text: "lukewarm", normalised: "lukewarm", translation: "tibio" }]);
  await page.reload();

  await page.locator('a[href="/registro/lukewarm"]').click();
  await expect(page).toHaveURL(/\/registro\/lukewarm$/);
});

test("a word never searched draws its own empty state, never a failure or a blank screen", async ({ page }) => {
  await deleteTranslator(page);
  await deleteLogDatabase(page);

  await page.goto("/registro/zzqqxv");
  await expect(page.getByRole("heading", { name: "zzqqxv" })).toBeVisible();
  await expect(page.getByText(messages.log.word.emptyBody.replace("{word}", "zzqqxv"))).toBeVisible();
  await expect(page.getByRole("button", { name: messages.log.word.emptyAction })).toBeVisible();
  await expect(page.getByText(messages.log.listFailed)).toHaveCount(0);
});

// The module 25 fix (`PalabraHistorialVacio`): the old copy borrowed from
// `study.emptyTitle`, "Todavía no has buscado nada" — false the moment the
// record holds even one row for some other word, which this seeds on
// purpose so a regression back to the borrowed copy fails loudly.
test("a word never searched keeps its own empty copy even when the record holds other words", async ({ page }) => {
  await deleteTranslator(page);

  await page.goto("/registro");
  await seedRows(page, [{ at: Date.now(), text: "lukewarm", normalised: "lukewarm", translation: "tibio" }]);

  await page.goto("/registro/zzqqxv");
  await expect(page.getByRole("heading", { name: "zzqqxv" })).toBeVisible();
  await expect(page.getByText(messages.log.word.emptyBody.replace("{word}", "zzqqxv"))).toBeVisible();
  await expect(page.getByText(messages.log.study.emptyTitle)).toHaveCount(0);

  // "Buscarla" hands the word straight to the search box.
  await page.getByRole("button", { name: messages.log.word.emptyAction }).click();
  await expect(page).toHaveURL(/\/\?q=zzqqxv$/);
  await expect(page.getByRole("textbox", { name: messages.search.label })).toHaveValue("zzqqxv");
});

// The dictionary's own longest headword, no space anywhere in it — the same
// literal string `word.spec.ts:157` and `estudio.spec.ts` already prove the
// search screen and the study hold at 360px. This screen's headline is
// `Headword`, which wraps mid-word by design (`headword.module.css`'s own
// `overflow-wrap: anywhere`) rather than truncating, so it carries none of
// `history-list.tsx`'s `Grid`+`Box`+`truncate` shape — proved here, not
// assumed from reading the component.
const LONGEST_HEADWORD = "Taumatawhakatangihangakoauauotamateaturipukakapikimaungahoronukupokaiwhenuakitanatahu";

test("a word's own headword with no space to break on never scrolls /registro/[palabra] sideways, at 360px", async ({
  page,
}) => {
  await deleteTranslator(page);

  await page.goto("/registro");
  await seedRows(page, [
    { at: Date.now(), text: LONGEST_HEADWORD, normalised: LONGEST_HEADWORD.toLowerCase(), translation: "tibio" },
  ]);
  await page.goto(`/registro/${LONGEST_HEADWORD.toLowerCase()}`);

  await expect(page.getByRole("heading", { name: LONGEST_HEADWORD })).toBeVisible();

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBe(clientWidth);
});

// A URL segment arrives percent-encoded, never decoded, on this Next
// version (measured against the page's own production build): a
// multi-word `normalised` used to render and to query IndexedDB as its own
// raw, still-encoded self, so a real record for "give up" never matched
// and the reader read a lie about a word they had searched twice.
test("a multi-word normalised decodes off its own URL segment, and still finds its own rows", async ({ page }) => {
  await deleteTranslator(page);

  await page.goto("/registro");
  await seedRows(page, [
    { at: Date.now() - DAY_MS, text: "give up", normalised: "give up", translation: "rendirse" },
    { at: Date.now(), text: "give up", normalised: "give up", translation: "rendirse" },
  ]);

  await page.goto("/registro/give%20up");
  await expect(page.getByRole("heading", { name: "give up" })).toBeVisible();
  await expect(page.getByText(/2 búsquedas/)).toBeVisible();
});

// The other half of the same defect: a word this record never held still
// names itself correctly in the empty state, and "Buscarla" hands the
// dictionary a real, single-decoded query — never `give%2520up`, the
// double-encoded href a raw `normalised` used to build.
test("a multi-word normalised never searched names itself right, and Buscarla finds the real entry", async ({
  page,
}) => {
  await deleteTranslator(page);
  await deleteLogDatabase(page);

  await page.goto("/registro/give%20up");
  await expect(page.getByRole("heading", { name: "give up" })).toBeVisible();
  await expect(page.getByText(messages.log.word.emptyBody.replace("{word}", "give up"))).toBeVisible();

  await page.getByRole("button", { name: messages.log.word.emptyAction }).click();
  await page.waitForURL(/\/\?q=/);
  expect(page.url()).toMatch(/\/\?q=give(\+|%20)up$/);
  await expect(page.getByRole("heading", { name: "give up" })).toBeVisible();
});

// Same defect, no space in sight: an accented `normalised` must decode too,
// not merely split on `%20`.
test("an accented normalised decodes off its own URL segment", async ({ page }) => {
  await deleteTranslator(page);
  await deleteLogDatabase(page);

  await page.goto("/registro/caf%C3%A9");
  await expect(page.getByRole("heading", { name: "café" })).toBeVisible();
});

// The mixed reading the fix must not produce: a real percent-encoded `%25`
// (a literal "%" character) decodes exactly once, to the same "100%" in
// every one of the three places that read `normalised` — the heading, the
// empty state's own body copy, and the query "Buscarla" hands the search
// box — never landing on `100%25` in one and `100%` in another.
test("a percent-encoded percent sign decodes once, the same way everywhere", async ({ page }) => {
  await deleteTranslator(page);
  await deleteLogDatabase(page);

  await page.goto("/registro/100%25");
  await expect(page.getByRole("heading", { name: "100%", exact: true })).toBeVisible();
  await expect(page.getByText(messages.log.word.emptyBody.replace("{word}", "100%"))).toBeVisible();

  await page.getByRole("button", { name: messages.log.word.emptyAction }).click();
  await page.waitForURL(/\/\?q=/);
  expect(page.url()).toMatch(/\/\?q=100%25$/);
});

// The regression that matters most: a single-word `normalised` carries no
// percent escape, so decoding it is a no-op — 75% of the dictionary's own
// entries take this path and must read exactly as they did before the fix.
test("a single-word normalised with nothing to decode is unchanged", async ({ page }) => {
  await deleteTranslator(page);
  await page.goto("/registro");
  await seedRows(page, [{ at: Date.now(), text: "book", normalised: "book", translation: "libro" }]);

  await page.goto("/registro/book");
  await expect(page.getByRole("heading", { name: "book" })).toBeVisible();
  await expect(page.getByText(messages.log.outcome.exact, { exact: true })).toHaveCount(1);
});

// The module's own done criterion: entering a word from the record answers
// with the dictionary itself, not with a truncated copy of a translation
// the log already cut to 120 characters. "bed" carries two senses, a noun
// and a verb, both sharing one IPA — real entries this dictionary edition
// holds, read straight from `public/dictionary` rather than trusted from a
// seeded row, so a change to the payload would fail this test loudly
// rather than pass on a fixture that no longer matches it.
test("/registro/bed answers with the same senses, translations and IPA /?q=bed does", async ({ page }) => {
  await deleteTranslator(page);
  await page.goto("/registro");
  await seedRows(page, [{ at: Date.now(), text: "bed", normalised: "bed", translation: "cama" }]);

  await page.goto("/registro/bed");
  await expect(page.getByRole("heading", { name: "bed" })).toBeVisible();
  await expect(page.getByText("/bed/").first()).toBeVisible();
  await expect(glossLocator(page, "cama")).toBeVisible();
  await expect(glossLocator(page, "lecho")).toBeVisible();
  await expect(glossLocator(page, "encamarse")).toBeVisible();
  // `glossLocator` alone would pass just as well against the old
  // one-gloss-per-line markup; this is the line that actually holds the
  // verb sense's two glosses joined (docs/voyager/DESIGN.md "The
  // translations are one line, separated by commas").
  await expect(page.getByText("encamarse, irse a la cama", { exact: true })).toBeVisible();
  // The one heading on the page is the word itself: `SenseList`'s own copy
  // of "bed" stays suppressed, or this locator would be ambiguous.
  await expect(page.getByRole("heading", { name: "bed" })).toHaveCount(1);
  // RNL-03's own board, at this project's 360px: two full senses, an IPA
  // and a translation list are more prose than the record ever drew here
  // before, and the first thing more prose does is overflow.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBe(clientWidth);

  await page.goto("/?q=bed");
  await expect(page.getByRole("heading", { name: "bed" })).toBeVisible();
  await expect(page.getByText("/bed/").first()).toBeVisible();
  await expect(glossLocator(page, "cama")).toBeVisible();
  await expect(glossLocator(page, "lecho")).toBeVisible();
  await expect(glossLocator(page, "encamarse")).toBeVisible();
  await expect(page.getByText("encamarse, irse a la cama", { exact: true })).toBeVisible();
});

// RNL-09: the dictionary is a local asset once installed, so re-entering a
// word off the record must read it from the device exactly as `/?q=` does
// — never fetch its payload again, and never reach a server route this
// screen has no business calling.
test("opening /registro/bed, with the dictionary already on the device, reaches the network zero times", async ({
  page,
}) => {
  await deleteTranslator(page);
  await page.goto("/?q=bed");
  await expect(glossLocator(page, "cama")).toBeVisible();

  await page.goto("/registro");
  await seedRows(page, [{ at: Date.now(), text: "bed", normalised: "bed", translation: "cama" }]);

  const assetPath = manifest.asset.path;
  let assetRequests = 0;
  let apiRequests = 0;
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes(assetPath)) assetRequests++;
    if (url.includes("/api/")) apiRequests++;
  });

  await page.goto("/registro/bed");
  await expect(glossLocator(page, "lecho")).toBeVisible();

  expect(assetRequests, "the dictionary asset is read off the device, never fetched again").toBe(0);
  expect(apiRequests, "no server route fires on this screen").toBe(0);
});

// RL-34: a sentence is never a headword, so asking the dictionary for one
// always misses — the bug this seeds against drew that miss's own copy,
// "El diccionario no tiene esa palabra", over a translation the row already
// held. `kind: "phrase"` is what tells the screen to read `translation`
// instead of asking the Worker for something a sentence can never answer.
test("a phrase's history draws its own stored translation, never the dictionary's word-not-found notice", async ({
  page,
}) => {
  await deleteTranslator(page);

  const phrase = "he holds a grudge against me";
  await page.goto("/registro");
  const seed = {
    text: phrase,
    normalised: phrase,
    translation: "me guarda rencor",
    kind: "phrase" as const,
    outcome: "translated" as const,
  };
  await seedRows(page, [
    { ...seed, at: Date.now() - DAY_MS },
    { ...seed, at: Date.now() },
  ]);

  await page.goto(`/registro/${encodeURIComponent(phrase)}`);
  await expect(page.getByRole("heading", { name: phrase })).toBeVisible();
  await expect(page.getByText(/2 búsquedas/)).toBeVisible();
  await expect(page.getByText("me guarda rencor", { exact: true })).toBeVisible();
  await expect(page.getByText(messages.search.notFound)).toHaveCount(0);
});

// The other half: a phrase every one of whose searches failed to translate
// carries no stored answer at all (`translation` null throughout). The
// screen must still not fall back to the word-dictionary's own miss copy —
// that copy answers a headword lookup, and this page never made one.
test("a phrase that never translated shows its own missing-translation copy, not the dictionary's", async ({
  page,
}) => {
  await deleteTranslator(page);

  const phrase = "this sentence never translated";
  await page.goto("/registro");
  await seedRows(page, [
    { at: Date.now(), text: phrase, normalised: phrase, translation: null, kind: "phrase", outcome: "untranslated" },
  ]);

  await page.goto(`/registro/${encodeURIComponent(phrase)}`);
  await expect(page.getByRole("heading", { name: phrase })).toBeVisible();
  await expect(page.getByText(messages.log.word.phraseMissing)).toBeVisible();
  await expect(page.getByText(messages.search.notFound)).toHaveCount(0);
});
