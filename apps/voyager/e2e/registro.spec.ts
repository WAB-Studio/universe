import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createTranslator } from "next-intl";
import { expect, test } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import postgres from "postgres";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";
import { DATABASE_VERSION } from "../lib/log/record";
import type { DictionaryPayload } from "../lib/dictionary/format";
import type { LookupRecord, SyncState } from "../lib/log/types";
import { closeRun, openRun } from "@repo/harness-registry";

// The same runtime `next-intl` renders with: `log.study.header` is an ICU
// plural, so a literal `"{lookups}"` substring never appears in the
// rendered text and a naive `.replace` against it always misses.
const t = createTranslator({ locale: "es", messages });

// `check:e2e` runs the bare Playwright CLI, no `--env-file`: the direct
// Postgres access the «vaciar aquí y en mi cuenta» tests need is not there
// unless this loads it itself. Silent on a missing file — a runner that
// already exported the five variables by hand keeps working.
try {
  process.loadEnvFile(path.join(__dirname, "../.env.local"));
} catch {
  // No .env.local: fall back to whatever the shell already set.
}

// Chromium's built-in `Translator` hangs `availability()` forever
// (docs/TRAPS.md); the word path here must never reach it.
async function deleteTranslator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

// Raw IndexedDB, mirroring `lib/log/record.ts`'s own shape — this runs
// inside `page.evaluate`, a browser context no Node import reaches, so it
// opens the same database by name instead of importing `record.ts`.
async function deleteLogDatabase(page: Page): Promise<void> {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase("reading-log");
  });
}

// Same store, read instead of wiped. Call this before any further
// navigation on `page`: `addInitScript` reinjects on every document `page`
// loads, not once (docs/TRAPS.md), so a `deleteLogDatabase`'d page that
// navigates again before this runs reads back nothing regardless of what
// was actually written.
async function readLogRows(page: Page): Promise<Array<{ normalised: string }>> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("reading-log");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("lookups", "readonly");
          const getAll = tx.objectStore("lookups").getAll();
          getAll.onsuccess = () => resolve(getAll.result);
          getAll.onerror = () => reject(getAll.error);
        };
      }),
  );
}

// Mirrors `lib/log/record.ts`'s own `onupgradeneeded` — this may race the
// app's own mount for who creates `reading-log` first, so it stays able to
// build both stores itself, the same reasoning `e2e/sync.spec.ts`'s own
// `seedLocalDatabase` gives.
async function seedLocalDatabase(
  page: Page,
  rows: { sync?: SyncState; lookups?: Array<Omit<LookupRecord, "id">> },
): Promise<void> {
  await page.evaluate(
    ({ version, sync, lookups }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("reading-log", version);
        request.onupgradeneeded = (event) => {
          const database = request.result;
          if (event.oldVersion < 1) {
            const store = database.createObjectStore("lookups", { keyPath: "id", autoIncrement: true });
            store.createIndex("at", "at");
            store.createIndex("normalised", "normalised");
          }
          if (event.oldVersion < 2) {
            database.createObjectStore("sync", { keyPath: "key" });
            request.transaction!
              .objectStore("lookups")
              .createIndex("foreign", ["device", "deviceSeq"], { unique: true });
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(["lookups", "sync"], "readwrite");
          if (sync) tx.objectStore("sync").put({ ...sync, key: "state" });
          for (const row of lookups ?? []) tx.objectStore("lookups").add(row);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
    { version: DATABASE_VERSION, sync: rows.sync ?? null, lookups: rows.lookups ?? [] },
  );
}

// The only trigger `SyncOnHide` listens for. `document.hidden` is a getter
// Playwright's own headless tab never flips on its own, so the property is
// redefined before the event fires.
async function hideTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

// Mirrors `scripts/harness/mint-reader-session.ts`'s own two functions: a
// fresh `auth.users` row with a landed recovery token, the only pair
// GoTrue's `verifyOtp` accepts. Kept local rather than imported — that
// script opens its own `postgres` connection and calls `process.exit`,
// neither of which belongs in a spec's module scope.
async function mintReaderIdentity(
  sql: postgres.Sql,
  runId: string,
): Promise<{ id: string; email: string; hash: string }> {
  const id = randomUUID();
  const email = `harness-reader-${id}@example.invalid`;

  await sql.begin(async (tx) => {
    await tx`
      insert into auth.users (
        id, instance_id, aud, role, email, email_confirmed_at,
        encrypted_password, confirmation_token, recovery_token,
        email_change, email_change_token_current, email_change_token_new,
        email_change_confirm_status, phone_change, phone_change_token,
        reauthentication_token, raw_app_meta_data, raw_user_meta_data,
        is_sso_user, is_anonymous, created_at, updated_at)
      values (
        ${id}, '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', ${email}, now(),
        '', '', '',
        '', '', '',
        0, '', '',
        '', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        false, false, now(), now())`;
    await tx`
      insert into harness.identities (user_id, run_id, email, disposition)
      values (${id}, ${runId}, ${email}, 'ephemeral')`;
  });

  const hash = randomBytes(32).toString("hex");
  await sql`
    update auth.users
    set recovery_token = ${hash}, recovery_sent_at = now(), updated_at = now()
    where id = ${id}`;
  await sql`
    insert into auth.one_time_tokens
      (id, user_id, token_type, token_hash, relates_to, created_at, updated_at)
    values
      (${randomUUID()}, ${id}, 'recovery_token', ${hash}, ${email}, now(), now())`;

  return { id, email, hash };
}

async function dropReaderIdentity(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from harness.identities where user_id = ${id}`;
  await sql`delete from auth.users where id = ${id}`;
}

// Same trick `mint-reader-session.ts`'s own `mintSessionCookie` plays: the
// route's `Set-Cookie` lands on this very redirect, and `page.request`
// shares the browser context's cookie jar, so the context is signed in the
// moment this resolves — no page ever has to visit the link itself.
async function signInAs(page: Page, hash: string): Promise<void> {
  const response = await page.request.get(`/auth/confirm?token_hash=${hash}&type=magiclink`, {
    maxRedirects: 0,
  });
  const location = response.headers()["location"];
  expect(location?.includes("error="), `redirected to ${location ?? "nowhere"}`).toBe(false);
}

// RL-04's own promise for an exact match: every Spanish translation the
// dictionary carries for the headword, not a placeholder or another word's
// answer. The shipped asset is the deterministic source for what a lookup
// on "apple" is owed — read the same way the running app reaches it, by
// `manifest.asset.path`, never a filename typed here by hand — so this
// never touches the network or the model, and never drifts if the asset is
// rebuilt under a new edition.
function dictionaryTranslations(word: string): string[] {
  const payload = JSON.parse(
    readFileSync(path.join(__dirname, "../public", manifest.asset.path), "utf8"),
  ) as DictionaryPayload;
  const normalised = word.toLowerCase();
  return payload.entries.filter(([headword]) => headword.toLowerCase() === normalised).flatMap(([, , , translations]) => [...translations]);
}

// `#RRGGBB` to the `rgb(r, g, b)` string `getComputedStyle` answers with —
// the only format Chromium ever normalises a colour to.
function hexToRgb(hex: string): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

async function computedColor(locator: Locator, property: "color" | "backgroundColor" = "color"): Promise<string> {
  return locator.evaluate((el, prop) => getComputedStyle(el)[prop as "color"], property);
}

// `record.ts`'s own guard (`typeof indexedDB === "undefined"`) is what a
// broken store looks like to this app; `open` throwing synchronously turns
// every read the screen makes into a rejected promise, the same way a real
// storage failure would.
async function breakIndexedDB(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: { open: () => { throw new Error("storage broken"); } },
    });
  });
}

test("a lookup's row lists the typed word, its count and the dictionary's own translation", async ({ page }) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("apple");
  // Clearing the box forces the flush `record.ts:129-143` describes: the
  // guard has no other way to learn a query was abandoned mid-word.
  await searchBox.fill("");
  await page.waitForTimeout(300);

  await page.goto("/registro");

  await expect(page.getByText(t("log.study.header", { lookups: 1, words: 1 }))).toBeVisible();

  const row = page.locator('a[href="/registro/apple"]');
  await expect(row).toBeVisible();
  const rowText = await row.innerText();
  expect(rowText).toContain("apple");
  expect(rowText).toContain("1");

  // RL-04: the row owes the reader the dictionary's own translations for
  // the word they searched, not merely something drawn where a translation
  // belongs. "apple" carries a single sense in the shipped dictionary, with
  // both "manzana" and "poma" — a row that instead drew another word's
  // translation, the bare headword, or a debug string would still pass a
  // non-empty check but fails each of these.
  const wordTranslations = dictionaryTranslations("apple");
  expect(wordTranslations.length, 'the shipped dictionary carries no entry for "apple"').toBeGreaterThan(0);
  for (const translation of wordTranslations) {
    expect(rowText, `the row for "apple" never shows its dictionary translation "${translation}"`).toContain(
      translation,
    );
  }
});

test("tapping \"Registro\" in the nav bar draws the search that motivated the trip, with no reload and no 5s wait", async ({
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
  await searchBox.fill("apple");
  // Long enough for the lookup's own promise to answer and `recordLookup`
  // to run, well short of `record.ts`'s own `SETTLE_MS` (800ms): the row
  // is still only `latestCandidate`, never even `pending`, when the tap
  // below fires — the flush it forces has to fold that candidate in too.
  await page.waitForTimeout(300);

  // A client-side navigation, not `page.goto`: this is the trigger
  // `pagehide`/`visibilitychange` never fire for.
  await page
    .getByRole("navigation", { name: messages.nav.label })
    .getByRole("link", { name: messages.nav.log })
    .click();
  await expect(page).toHaveURL(/\/registro$/);

  // No ceiling forces this row to wait: the unmount flush this tap triggers
  // is the only thing that has to land before the count shows.
  await expect(page.getByText(t("log.study.header", { lookups: 1, words: 1 }))).toBeVisible({ timeout: 2500 });

  const row = page.locator('a[href="/registro/apple"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText("apple");
});

test("with no rows, /registro draws the study's empty state and its action returns to /", async ({ page }) => {
  await deleteTranslator(page);
  await deleteLogDatabase(page);

  await page.goto("/registro");
  await expect(page.getByText(messages.log.study.emptyTitle)).toBeVisible();
  await expect(page.getByText(messages.log.study.emptyBody)).toBeVisible();

  // The empty study already says there is nothing here; a download link
  // for a file with no rows in it would only repeat that with an action
  // that does not work.
  await expect(page.getByRole("button", { name: messages.log.study.download })).toHaveCount(0);
  await expect(page.getByText(t("log.study.header", { lookups: 0, words: 0 }))).toHaveCount(0);

  await page.getByRole("button", { name: messages.log.study.emptyAction }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("a reader who only ever missed leaves no row, and /registro still shows the empty state, not a dead screen", async ({
  page,
}) => {
  await deleteTranslator(page);
  await deleteLogDatabase(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  // RL-39: a word the dictionary carries nothing for leaves no row. A
  // multi-character nonsense string, not a single letter, so it stays a
  // miss regardless of the other lane's own change to one-character
  // queries.
  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("xyzzy");
  await searchBox.fill("");
  await page.waitForTimeout(300);

  // Read here, on this same document, before anything navigates again:
  // `deleteLogDatabase`'s `addInitScript` reinjects on the `goto` below too
  // and would wipe whatever RL-39's guard left behind before the assertion
  // ever got to see it.
  const rows = await readLogRows(page);
  expect(rows).toHaveLength(0);

  await page.goto("/registro");
  await expect(page.getByText(messages.log.study.emptyTitle)).toBeVisible();
  await expect(page.getByText(messages.log.study.emptyBody)).toBeVisible();
  await expect(page.getByText(t("log.study.header", { lookups: 0, words: 0 }))).toHaveCount(0);
});

test("with the store broken, /registro draws the failure, with no system red and a retry", async ({ page }) => {
  await deleteTranslator(page);
  await breakIndexedDB(page);

  await page.goto("/registro");
  await expect(page.getByText(messages.log.study.failedTitle)).toBeVisible();
  await expect(page.getByText(messages.log.study.failedBody)).toBeVisible();
  await expect(page.getByRole("button", { name: messages.log.study.failedAction })).toBeVisible();
});

test("at rest, /registro shows «Vaciar el registro» muted beside «Descargar el registro» accent, and its confirm keeps the accent off both destructive options — no red, in light and dark", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("apple");
  await searchBox.fill("");
  await page.waitForTimeout(300);

  // A reader, so the confirm block draws both destructive options: the
  // colours below belong to `RegistroVaciarConfirmar`, the signed-in board,
  // not the single-action one a session-less reader gets.
  const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  const runId = await openRun("e2e", sql);
  const reader = await mintReaderIdentity(sql, runId);

  try {
    await signInAs(page, reader.hash);

    // `docs/voyager/DESIGN.md` "Tokens" fixes a different hex per mode for
    // both roles this reads — the accent and the muted tone both change
    // between the two passes below, not just which token wins.
    const palette = {
      light: { accent: "#9A3B24", muted: "#6B675A" },
      dark: { accent: "#D9805F", muted: "#9A9484" },
    } as const;

    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/registro");

      const download = page.getByRole("button", { name: messages.log.study.download });
      const clearTrigger = page.getByRole("button", { name: messages.log.clear.trigger });
      await expect(download).toBeVisible();
      await expect(clearTrigger).toBeVisible();

      expect(await computedColor(download)).toBe(hexToRgb(palette[scheme].accent));
      expect(await computedColor(clearTrigger)).toBe(hexToRgb(palette[scheme].muted));

      await clearTrigger.click();
      const keep = page.getByRole("button", { name: messages.log.clear.keep });
      const localAction = page.getByRole("button", { name: messages.log.clear.localAction });
      const accountAction = page.getByRole("button", { name: messages.log.clear.accountAction });
      await expect(keep).toBeVisible();
      await expect(localAction).toBeVisible();
      await expect(accountAction).toBeVisible();

      // No red anywhere the break draws (`docs/voyager/DESIGN.md` "Failure"):
      // the accent lives only on «Conservarlo», never on either destructive
      // option, in neither mode.
      expect(await computedColor(keep, "backgroundColor")).toBe(hexToRgb(palette[scheme].accent));
      expect(await computedColor(localAction)).toBe(hexToRgb(palette[scheme].muted));
      expect(await computedColor(accountAction)).toBe(hexToRgb(palette[scheme].muted));
    }
  } finally {
    await dropReaderIdentity(sql, reader.id);
    await closeRun(sql);
    await sql.end();
  }
});

test("without a session, the confirm panel draws no account option at all, and the one action left reads «Vaciar el registro»", async ({
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
  await searchBox.fill("apple");
  await searchBox.fill("");
  await page.waitForTimeout(300);

  await page.goto("/registro");
  await page.getByRole("button", { name: messages.log.clear.trigger }).click();

  await expect(page.getByRole("button", { name: messages.log.clear.keep })).toBeVisible();
  await expect(page.getByRole("button", { name: messages.log.clear.soleAction })).toBeVisible();
  await expect(page.getByRole("button", { name: messages.log.clear.accountAction })).toHaveCount(0);
  await expect(page.getByRole("button", { name: messages.log.clear.localAction })).toHaveCount(0);
});

test("«Conservarlo» closes the confirmation without deleting anything", async ({ page }) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("apple");
  await searchBox.fill("");
  await page.waitForTimeout(300);

  await page.goto("/registro");
  await expect(page.getByText(t("log.study.header", { lookups: 1, words: 1 }))).toBeVisible();

  await page.getByRole("button", { name: messages.log.clear.trigger }).click();
  const keep = page.getByRole("button", { name: messages.log.clear.keep });
  await expect(keep).toBeVisible();
  await keep.click();

  await expect(keep).toHaveCount(0);
  await expect(page.getByText(t("log.study.header", { lookups: 1, words: 1 }))).toBeVisible();
  const rows = await readLogRows(page);
  expect(rows).toHaveLength(1);
});

test("without a session, «Vaciar el registro» empties IndexedDB, falls to the existing empty state, and a lookup made afterwards still lands", async ({
  page,
}) => {
  await deleteTranslator(page);

  const firstAsset = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await firstAsset;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("apple");
  await searchBox.fill("");
  await page.waitForTimeout(300);

  await page.goto("/registro");
  await page.getByRole("button", { name: messages.log.clear.trigger }).click();
  await page.getByRole("button", { name: messages.log.clear.soleAction }).click();

  await expect(page.getByText(messages.log.study.emptyTitle)).toBeVisible();
  expect(await readLogRows(page)).toHaveLength(0);

  // The store itself still works after `clearLocalLookups`'s own `clear()`:
  // a lookup made right after lands a fresh row, same as it always does.
  // No second `waitForResponse` here: the asset already landed once this
  // browser context, and a revisit serves it from the cache with no fresh
  // network response Playwright's own predicate can ever see.
  await page.goto("/");
  await page.waitForTimeout(2000);

  await searchBox.fill("banana");
  await searchBox.fill("");
  await page.waitForTimeout(300);

  await page.goto("/registro");
  await expect(page.getByText(t("log.study.header", { lookups: 1, words: 1 }))).toBeVisible();
  await expect(page.locator('a[href="/registro/banana"]')).toBeVisible();
});

test("without a session, «Vaciar el registro» drops the download link too, with no reload", async ({ page }) => {
  await deleteTranslator(page);

  const firstAsset = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await firstAsset;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("apple");
  await searchBox.fill("");
  await page.waitForTimeout(300);

  await page.goto("/registro");
  const download = page.getByRole("button", { name: messages.log.study.download });
  await expect(download).toBeVisible();

  await page.getByRole("button", { name: messages.log.clear.trigger }).click();
  await page.getByRole("button", { name: messages.log.clear.soleAction }).click();

  // No `page.reload()` anywhere here: `ExportPanel` has to notice the wipe
  // on its own, the same way the study above it already does.
  await expect(page.getByText(messages.log.study.emptyTitle)).toBeVisible();
  await expect(download).toHaveCount(0);
});

test("«Vaciar sólo en este dispositivo» does not come back on the next sync", async ({ page }) => {
  test.setTimeout(45_000);
  await deleteTranslator(page);

  const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  const runId = await openRun("e2e", sql);
  const reader = await mintReaderIdentity(sql, runId);
  const ownDeviceId = randomUUID();
  const foreignDeviceId = randomUUID();

  try {
    // A row another of this reader's own devices already copied to the
    // account — exactly what a wipe on *this* device must not be able to
    // pull back down.
    await sql`insert into reading.lookups
      (user_id, device_id, local_id, at, text, normalised, kind, outcome, headword, rule, senses, translation, dictionary_ready, origin, record_schema)
      values (${reader.id}, ${foreignDeviceId}, 1, now(), 'foreign-word', 'foreign-word', 'word', 'miss', null, null, 0, null, true, null, 2)`;

    await page.goto("/registro");
    await expect(page.getByRole("heading", { name: messages.log.title })).toBeVisible();

    await seedLocalDatabase(page, {
      sync: {
        deviceId: ownDeviceId,
        pushedThroughLocalId: null,
        pulledThroughCursor: null,
        lastSyncedAt: null,
        enabled: true,
      },
    });

    await signInAs(page, reader.hash);

    // First sync: pulls the foreign row down onto this device.
    await hideTab(page);
    await page.waitForTimeout(2000);
    await page.reload();
    let rows = await readLogRows(page);
    expect(rows.map((row) => row.normalised), "the foreign row never made it down").toContain("foreign-word");

    await page.getByRole("button", { name: messages.log.clear.trigger }).click();
    await page.getByRole("button", { name: messages.log.clear.localAction }).click();
    await expect(page.getByText(messages.log.study.emptyTitle)).toBeVisible();
    rows = await readLogRows(page);
    expect(rows).toHaveLength(0);

    // A fresh mount resets `SyncOnHide`'s own 60s gate, so the sync below is
    // a new call, not the same one blocked from firing twice.
    await page.reload();
    await hideTab(page);
    await page.waitForTimeout(2000);

    rows = await readLogRows(page);
    expect(rows, "the wiped row came back on the very next sync").toHaveLength(0);
  } finally {
    await dropReaderIdentity(sql, reader.id);
    await closeRun(sql);
    await sql.end();
  }
});

test("«Vaciar aquí y en mi cuenta» empties every device's copy, and a reader cannot touch another reader's rows", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await deleteTranslator(page);

  const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  const runId = await openRun("e2e", sql);
  const reader = await mintReaderIdentity(sql, runId);
  const bystander = await mintReaderIdentity(sql, runId);
  const foreignDeviceId = randomUUID();

  try {
    // A row from a device other than the one this test signs in from: the
    // confirm screen's own promise ("se lleva también lo que registraron
    // tus otros dispositivos") has something to prove against.
    await sql`insert into reading.lookups
      (user_id, device_id, local_id, at, text, normalised, kind, outcome, headword, rule, senses, translation, dictionary_ready, origin, record_schema)
      values (${reader.id}, ${foreignDeviceId}, 1, now(), 'other-device-word', 'other-device-word', 'word', 'miss', null, null, 0, null, true, null, 2)`;

    // Untouched by anything this test does through the app — this count is
    // what proves the policy fires, not the route's own `where` clause.
    await sql`insert into reading.lookups
      (user_id, device_id, local_id, at, text, normalised, kind, outcome, headword, rule, senses, translation, dictionary_ready, origin, record_schema)
      values
        (${bystander.id}, ${randomUUID()}, 1, now(), 'bystander-word-1', 'bystander-word-1', 'word', 'miss', null, null, 0, null, true, null, 2),
        (${bystander.id}, ${randomUUID()}, 1, now(), 'bystander-word-2', 'bystander-word-2', 'word', 'miss', null, null, 0, null, true, null, 2)`;

    await page.goto("/registro");
    await expect(page.getByRole("heading", { name: messages.log.title })).toBeVisible();

    // A row this device recorded itself, so `ClearPanel`'s own count gate
    // has something to show before the reader ever signs in.
    await seedLocalDatabase(page, {
      lookups: [
        {
          schema: 2,
          at: Date.now(),
          text: "local-word",
          normalised: "local-word",
          kind: "word",
          outcome: "miss",
          headword: null,
          rule: null,
          senses: 0,
          translation: null,
          dictionaryReady: true,
          origin: null,
        },
      ],
    });

    await signInAs(page, reader.hash);
    await page.reload();

    const clearTrigger = page.getByRole("button", { name: messages.log.clear.trigger });
    await expect(clearTrigger).toBeVisible();
    await clearTrigger.click();

    const clearResponse = page.waitForResponse(
      (response) => response.url().includes("/api/log/clear") && response.request().method() === "DELETE",
    );
    await page.getByRole("button", { name: messages.log.clear.accountAction }).click();
    expect((await clearResponse).status()).toBe(200);

    await expect(page.getByText(messages.log.study.emptyTitle)).toBeVisible();
    expect(await readLogRows(page)).toHaveLength(0);

    const [readerLeft] = await sql<{ count: number }[]>`
      select count(*)::int as count from reading.lookups where user_id = ${reader.id}`;
    expect(readerLeft.count, "the reader's own account still holds a row").toBe(0);

    const [bystanderLeft] = await sql<{ count: number }[]>`
      select count(*)::int as count from reading.lookups where user_id = ${bystander.id}`;
    expect(bystanderLeft.count, "another reader's rows moved when they should not have").toBe(2);
  } finally {
    await dropReaderIdentity(sql, reader.id);
    await dropReaderIdentity(sql, bystander.id);
    await closeRun(sql);
    await sql.end();
  }
});
