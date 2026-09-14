import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { AuthApiError, AuthRetryableFetchError, isAuthRetryableFetchError } from "@supabase/supabase-js";
import postgres from "postgres";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";
import { DATABASE_VERSION } from "../lib/log/record";
import type { LookupRecord, SyncState } from "../lib/log/types";
import { closeRun, openRun } from "@repo/harness-registry";

// `check:e2e` runs the bare Playwright CLI, no `--env-file`: the direct
// Postgres access module 4 needs is not there unless this loads it itself.
// Silent on a missing file — a runner that already exported the five
// variables by hand keeps working.
try {
  process.loadEnvFile(path.join(__dirname, "../.env.local"));
} catch {
  // No .env.local: fall back to whatever the shell already set.
}

// Chromium's built-in `Translator` hangs `availability()` forever
// (docs/TRAPS.md); every test below reaches a screen that calls it.
async function deleteTranslator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

// The only trigger `sync-on-hide.tsx` and `flushPendingLookup` listen for.
// `document.hidden` is a getter Playwright's own headless tab never flips on
// its own, so the property is redefined before the event fires.
async function hideTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

// `useDecoration`'s own debounce (`PHRASE_DEBOUNCE_MS`) plus margin: long
// enough that its pair of requests has fired by the time this elapses.
const DECORATION_SETTLE_MARGIN_MS = 900;

type SeedSyncRow = SyncState;
type SeedLookupRow = Omit<LookupRecord, "id">;

// Mirrors `record.ts`'s own `onupgradeneeded` (`export.spec.ts`'s `seedRows`,
// same reasoning): this may race the app's own mount for who creates
// `reading-log` first, so it stays able to build both stores itself.
async function seedLocalDatabase(
  page: Page,
  rows: { sync?: SeedSyncRow; lookups?: SeedLookupRow[] },
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

// The raw count `lib/log/record.ts`'s own `countRecords()` answers, read the
// same way `export.spec.ts`'s `readRawRows` reads the store: no import
// reaches into a page's own IndexedDB, so this opens it by name instead.
async function countLocalRecords(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("reading-log");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const count = db.transaction("lookups", "readonly").objectStore("lookups").count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
        };
      }),
  );
}

// The one row `record.ts`'s own `sync` store ever holds, read the same way
// `countLocalRecords` reads `lookups`: no import reaches into a page's own
// IndexedDB, so this opens it by name instead.
async function readSyncRow(page: Page): Promise<SyncState | undefined> {
  return page.evaluate(
    () =>
      new Promise<SyncState | undefined>((resolve, reject) => {
        const request = indexedDB.open("reading-log");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const get = db.transaction("sync", "readonly").objectStore("sync").get("state");
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        };
      }),
  );
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

test("RNL-09: with no account, ten keystrokes and a hidden tab issue nothing to /api/log/sync", async ({
  page,
}) => {
  await deleteTranslator(page);

  const syncRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/log/sync")) syncRequests.push(request.url());
  });

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.pressSequentially("throughout", { delay: 40 });

  await hideTab(page);
  await page.waitForTimeout(2000);

  expect(syncRequests, `sync requests seen: ${JSON.stringify(syncRequests)}`).toHaveLength(0);
});

test("RL-14: the word-path guard holds with the sync driver mounted in the layout", async ({ page }) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  const tenKeystrokes = "throughout";

  // A warm-up run first, autocomplete included, so every font any state
  // along the way paints is already cached before the measured run — a font
  // request belongs to painting a state for the first time, not to RL-14.
  // Clearing the box straight after the heading aborts decoration's own
  // debounce before it fires, so the word is never cached from this run.
  await searchBox.pressSequentially(tenKeystrokes, { delay: 40 });
  await expect(page.getByRole("heading", { name: tenKeystrokes })).toBeVisible();
  await searchBox.fill("");
  await page.waitForTimeout(300);

  const requestsWhileTyping: string[] = [];
  page.on("request", (request) => requestsWhileTyping.push(request.url()));

  await searchBox.pressSequentially(tenKeystrokes, { delay: 40 });
  await expect(page.getByRole("heading", { name: tenKeystrokes })).toBeVisible();

  // The stricter bound: at the instant of paint, decoration's own debounce
  // has not fired yet, so ten keystrokes owe nothing at all — the route
  // included.
  expect(
    requestsWhileTyping,
    `requests at paint, ten keystrokes issued: ${JSON.stringify(requestsWhileTyping)}`,
  ).toHaveLength(0);

  await page.waitForTimeout(DECORATION_SETTLE_MARGIN_MS);

  const stray = requestsWhileTyping.filter((url) => !url.includes("/api/word/"));
  expect(stray, `requests foreign to decoration: ${JSON.stringify(stray)}`).toEqual([]);

  // One settled word, never one request per keystroke.
  const decoration = requestsWhileTyping.filter((url) => url.includes("/api/word/"));
  expect(decoration.length).toBeLessThanOrEqual(2);
});

test("RL-24: the copy fires on hide, never on a keystroke, and the request lands even unauthenticated", async ({
  page,
}) => {
  await deleteTranslator(page);

  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;

  // `enabled: true`, hand-seeded: no reader signs in over this suite, so this
  // is the only way the driver ever finds a copy switched on. One local row
  // gives `syncNow()` something to push.
  await seedLocalDatabase(page, {
    sync: {
      deviceId: randomUUID(),
      pushedThroughLocalId: null,
      pulledThroughCursor: null,
      lastSyncedAt: null,
      enabled: true,
    },
    lookups: [
      {
        schema: 2,
        at: Date.now(),
        text: "portmanteau",
        normalised: "portmanteau",
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

  const syncRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/log/sync")) syncRequests.push(request.url());
  });

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.pressSequentially("throughout", { delay: 40 });
  expect(syncRequests, `while visible: ${JSON.stringify(syncRequests)}`).toHaveLength(0);

  const syncRequest = page.waitForRequest((request) => request.url().includes("/api/log/sync"));
  await hideTab(page);
  await syncRequest;
  // The route answers 401 with no session; `postBatch` throws on it and
  // `syncNow` stops there, so nothing more should follow.
  await page.waitForTimeout(500);

  expect(syncRequests, `after hide: ${JSON.stringify(syncRequests)}`).toHaveLength(1);
});

test("RL-24: retiring a device drops its rows from the copy, never from the local log", async ({ page }) => {
  test.setTimeout(45_000);
  await deleteTranslator(page);

  const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  const runId = await openRun("e2e", sql);
  const readerId = randomUUID();
  const readerEmail = `harness-reader-${readerId}@example.invalid`;
  const ownDeviceId = randomUUID();
  const foreignDeviceId = randomUUID();
  const ownLabel = "Firefox en Linux";
  const foreignLabel = "Chrome en Android";

  try {
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
          ${readerId}, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', ${readerEmail}, now(),
          '', '', '',
          '', '', '',
          0, '', '',
          '', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
          false, false, now(), now())`;
      await tx`
        insert into harness.identities (user_id, run_id, email, disposition)
        values (${readerId}, ${runId}, ${readerEmail}, 'ephemeral')`;
    });

    // Plain `postgres` here, no `SET ROLE authenticated`: the grant to
    // `authenticated` names only `(user_id, device_id, label)` — `check-sync.ts`'s
    // own S3 assertion, mirrored for `devices` — and this insert also wants
    // `last_seen_at`, which only the connection's own superuser reaches.
    // `foreign`'s `last_seen_at` is the more recent of the two, so the
    // server's own `order by last_seen_at desc` always lists it first.
    await sql`insert into reading.devices (user_id, device_id, label, last_seen_at) values
      (${readerId}, ${ownDeviceId}, ${ownLabel}, now() - interval '1 hour'),
      (${readerId}, ${foreignDeviceId}, ${foreignLabel}, now())`;

    // Lands a real session the way `mint-reader-session.ts` proved: a hash in
    // both `auth.users.recovery_token` and a matching `auth.one_time_tokens`
    // row, the only pair GoTrue's `verifyOtp` accepts.
    const hash = randomBytes(32).toString("hex");
    await sql`
      update auth.users
      set recovery_token = ${hash}, recovery_sent_at = now(), updated_at = now()
      where id = ${readerId}`;
    await sql`
      insert into auth.one_time_tokens
        (id, user_id, token_type, token_hash, relates_to, created_at, updated_at)
      values
        (${randomUUID()}, ${readerId}, 'recovery_token', ${hash}, ${readerEmail}, now(), now())`;

    // `/registro` never reads `sync`, so seeding it here cannot race the
    // account screen's own mount effect the way seeding it on `/cuenta` would.
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
      lookups: Array.from({ length: 3 }, (_, index) => ({
        schema: 2,
        at: Date.now() - index,
        text: `foreign-${index}`,
        normalised: `foreign-${index}`,
        kind: "word" as const,
        outcome: "miss" as const,
        headword: null,
        rule: null,
        senses: 0,
        translation: null,
        dictionaryReady: true,
        origin: null,
        device: foreignDeviceId,
        deviceSeq: index,
      })),
    });

    const recordsBefore = await countLocalRecords(page);
    expect(recordsBefore).toBe(3);

    // `page.request` shares the browser context's cookie jar: the `Set-Cookie`
    // on this very redirect lands in the context, so `/cuenta` below opens
    // signed in. `maxRedirects: 0` is what keeps a followed hop from ever
    // reading `location` after this route's own headers already answered.
    const confirmResponse = await page.request.get(`/auth/confirm?token_hash=${hash}&type=magiclink`, {
      maxRedirects: 0,
    });
    const location = confirmResponse.headers()["location"];
    expect(location?.includes("error="), `redirected to ${location ?? "nowhere"}`).toBe(false);

    await page.goto("/cuenta");
    await expect(page.getByText(foreignLabel)).toBeVisible();
    await expect(page.getByText(ownLabel)).toBeVisible();

    await page.getByRole("button", { name: messages.account.devices.retire }).first().click();
    const retireResponse = page.waitForResponse(
      (response) => response.url().includes("/api/devices") && response.request().method() === "DELETE",
    );
    await page.getByRole("button", { name: messages.account.devices.confirm }).click();
    expect((await retireResponse).status()).toBe(200);

    await expect(page.getByText(foreignLabel)).toHaveCount(0);
    await expect(page.getByText(ownLabel)).toBeVisible();

    const recordsAfter = await countLocalRecords(page);
    expect(recordsAfter).toBe(recordsBefore);
  } finally {
    await sql`delete from harness.identities where user_id = ${readerId}`;
    await sql`delete from auth.users where id = ${readerId}`;
    await closeRun(sql);
    await sql.end();
  }
});

test("RL-24: a request whose top-level deviceId disagrees with its rows never seals or excludes that top-level id", async ({
  page,
}) => {
  test.setTimeout(45_000);

  const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  const runId = await openRun("e2e", sql);
  const readerId = randomUUID();
  const readerEmail = `harness-reader-${readerId}@example.invalid`;
  // The two disagree on purpose: a request naming one `deviceId` at the top
  // and another on its own row is exactly the shape module 36's bug shipped
  // — sealing and excluding the top-level id, then handing the row's own
  // device straight back down in the same response.
  const rowDeviceId = randomUUID();
  const topDeviceId = randomUUID();

  try {
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
          ${readerId}, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', ${readerEmail}, now(),
          '', '', '',
          '', '', '',
          0, '', '',
          '', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
          false, false, now(), now())`;
      await tx`
        insert into harness.identities (user_id, run_id, email, disposition)
        values (${readerId}, ${runId}, ${readerEmail}, 'ephemeral')`;
    });

    // Same magic-link mint as the retire test above: a hash in both
    // `auth.users.recovery_token` and a matching `auth.one_time_tokens` row.
    const hash = randomBytes(32).toString("hex");
    await sql`
      update auth.users
      set recovery_token = ${hash}, recovery_sent_at = now(), updated_at = now()
      where id = ${readerId}`;
    await sql`
      insert into auth.one_time_tokens
        (id, user_id, token_type, token_hash, relates_to, created_at, updated_at)
      values
        (${randomUUID()}, ${readerId}, 'recovery_token', ${hash}, ${readerEmail}, now(), now())`;

    const confirmResponse = await page.request.get(`/auth/confirm?token_hash=${hash}&type=magiclink`, {
      maxRedirects: 0,
    });
    const location = confirmResponse.headers()["location"];
    expect(location?.includes("error="), `redirected to ${location ?? "nowhere"}`).toBe(false);

    const response = await page.request.post("/api/log/sync", {
      data: {
        deviceId: topDeviceId,
        since: null,
        rows: [
          {
            deviceId: rowDeviceId,
            localId: 1,
            at: Date.now(),
            text: "regression-guard",
            normalised: "regression-guard",
            kind: "word",
            outcome: "miss",
            headword: null,
            rule: null,
            senses: 0,
            translation: null,
            dictionaryReady: true,
            origin: null,
            recordSchema: DATABASE_VERSION,
          },
        ],
      },
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { accepted: number; rows: Array<{ deviceId: string; localId: number }> };
    expect(body.accepted).toBe(1);

    // The half that read as a leak: the row this same request just uploaded
    // must never come back down in `rows` of that same response.
    const echoed = body.rows.filter((row) => row.deviceId === rowDeviceId && row.localId === 1);
    expect(echoed, `rows echoed back: ${JSON.stringify(body.rows)}`).toHaveLength(0);

    // The other half: `reading.devices` is sealed for the row's own device,
    // never for the disagreeing top-level one.
    const devices = await sql`select device_id from reading.devices where user_id = ${readerId}`;
    const deviceIds = devices.map((row) => row.device_id);
    expect(deviceIds).toEqual([rowDeviceId]);
    expect(deviceIds).not.toContain(topDeviceId);
  } finally {
    await sql`delete from harness.identities where user_id = ${readerId}`;
    await sql`delete from auth.users where id = ${readerId}`;
    await closeRun(sql);
    await sql.end();
  }
});

test("RL-30: opening /cuenta with a fresh session turns the copy on and fires it, with no button and no counts drawn", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await deleteTranslator(page);

  const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  const runId = await openRun("e2e", sql);
  const { id: readerId, hash } = await mintReaderIdentity(sql, runId);

  try {
    await signInAs(page, hash);

    // The one round trip `syncNow()` makes even with nothing local to push:
    // a fresh device still pulls whatever the account already holds.
    // `lastSyncedAt` is only written once the response lands (`driver.ts`'s
    // own `writeSyncState` call), so this waits for the response, not the
    // request going out.
    const syncResponse = page.waitForResponse((response) => response.url().includes("/api/log/sync"));
    await page.goto("/cuenta");
    await expect(page.getByRole("heading", { name: messages.account.title })).toBeVisible();
    await syncResponse;
    await page.waitForTimeout(500);

    const row = await readSyncRow(page);
    expect(row?.enabled, `sync row: ${JSON.stringify(row)}`).toBe(true);
    expect(row?.lastSyncedAt, `sync row: ${JSON.stringify(row)}`).not.toBeNull();

    // RL-23's consent button is gone, not hidden: no control ever names two
    // figures for the reader to weigh.
    await expect(page.getByRole("button", { name: /suben.*bajan/ })).toHaveCount(0);
  } finally {
    await dropReaderIdentity(sql, readerId);
    await closeRun(sql);
    await sql.end();
  }
});

test("RL-30, RNL-09: signing out disables the copy, drops the box's stored query, and a later hidden tab reaches /api/log/sync no more", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await deleteTranslator(page);

  const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  const runId = await openRun("e2e", sql);
  const { id: readerId, hash } = await mintReaderIdentity(sql, runId);

  try {
    await signInAs(page, hash);

    const firstSync = page.waitForRequest((request) => request.url().includes("/api/log/sync"));
    await page.goto("/cuenta");
    await firstSync;
    await page.waitForTimeout(500);

    // The leak the module 8 validator drove: a word looked up before
    // signing out must not pre-fill `Buscar` for whoever opens this tab
    // next (`components/ui/bottom-nav.tsx:41-42`).
    await page.evaluate(() => window.sessionStorage.setItem("voyager:nav-query", "portmanteau"));

    await page.getByRole("button", { name: messages.account.signOut }).click();
    await expect(page).toHaveURL(/\/registro$/);

    const navQuery = await page.evaluate(() => window.sessionStorage.getItem("voyager:nav-query"));
    expect(navQuery).toBeNull();

    const row = await readSyncRow(page);
    expect(row?.enabled, `sync row after sign-out: ${JSON.stringify(row)}`).toBe(false);

    const syncRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/log/sync")) syncRequests.push(request.url());
    });
    await hideTab(page);
    await page.waitForTimeout(1500);
    expect(syncRequests, `sync requests after sign-out: ${JSON.stringify(syncRequests)}`).toHaveLength(0);
  } finally {
    await dropReaderIdentity(sql, readerId);
    await closeRun(sql);
    await sql.end();
  }
});

test("RL-22: a sign-in link that verifyOtp rejects lands on /cuenta with its own message, not silence", async ({
  page,
}) => {
  // No minted identity: a hash `auth.one_time_tokens` never held is exactly
  // what `route.ts`'s `verifyOtp` call answers with an error for — a genuine
  // rejection, not a timeout, so it lands `error=linkInvalid` (RL-49).
  const bogusHash = randomBytes(32).toString("hex");
  const response = await page.request.get(`/auth/confirm?token_hash=${bogusHash}&type=magiclink`, {
    maxRedirects: 0,
  });
  const location = response.headers()["location"];
  expect(location, `redirected to ${location ?? "nowhere"}`).toContain("error=linkInvalid");

  await page.goto("/cuenta?error=linkInvalid");
  await expect(page.getByText(messages.account.errors.linkInvalidTitle)).toBeVisible();
  await expect(page.getByText(messages.account.errors.linkInvalidBody)).toBeVisible();
  await expect(page.getByText(messages.account.errors.linkTimeoutTitle)).toHaveCount(0);
});

// RL-49: `/cuenta?error=linkTimeout` is what `route.ts` sends for the
// gateway-never-answered case. Reached directly, with no token at all — the
// screen only reads the query string, so no `verifyOtp` call is in play
// here and nothing spends a real send.
test("RL-49: a timed-out verification names the failure as ours, not the link's", async ({ page }) => {
  await page.goto("/cuenta?error=linkTimeout");
  await expect(page.getByText(messages.account.errors.linkTimeoutTitle)).toBeVisible();
  await expect(page.getByText(messages.account.errors.linkTimeoutBody)).toBeVisible();
  await expect(page.getByText(messages.account.errors.linkInvalidTitle)).toHaveCount(0);
});

// `route.ts`'s own mapping is one ternary on `isAuthRetryableFetchError` —
// proved here against fabricated auth-js error instances, not imported from
// `route.ts` itself: that module pulls in `@repo/supabase-auth`, which
// requires `server-only` and `next/headers` and cannot load outside a
// running Next server, so this proves the predicate the handler branches
// on rather than the handler. A real 504 cannot be summoned on demand, and
// nothing here calls `verifyOtp` to try.
test("RL-49: isAuthRetryableFetchError tells the gateway-timeout shape from a genuine rejection", () => {
  const gatewayTimeout = new AuthRetryableFetchError("Fetch failed", 504);
  expect(isAuthRetryableFetchError(gatewayTimeout)).toBe(true);

  const spentToken = new AuthApiError("Token has expired or is invalid", 403, "otp_expired");
  expect(isAuthRetryableFetchError(spentToken)).toBe(false);

  expect(isAuthRetryableFetchError(null)).toBe(false);
});

// Requirement 3: nothing in the handler retries `verifyOtp` down either
// path. Read from source rather than driven, because a browser run cannot
// tell "called once" from "called once, then retried and the second
// answer is what redirected" — the log line only proves the last call.
test("RL-49: /auth/confirm calls verifyOtp exactly once, on every path", () => {
  const source = readFileSync(path.join(__dirname, "../app/auth/confirm/route.ts"), "utf8");
  const calls = source.match(/\.verifyOtp\(/g) ?? [];
  expect(calls, `verifyOtp call sites: ${calls.length}`).toHaveLength(1);
});
