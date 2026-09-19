import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";

const DATABASE_NAME = "reading-credits";

async function deleteTranslator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

// Runs before every document this page creates, so it lands ahead of
// `ForgetPhotoCredits`'s own effect. Closes its connection in `oncomplete`,
// before the app's bundle even starts executing — the trap this spec must
// not fall into: a seed that leaves `reading-credits` open turns the
// component's `deleteDatabase` into `onblocked`, never `onsuccess`.
async function seedPhotoCredits(page: Page): Promise<void> {
  await page.addInitScript((name) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("credits", { keyPath: "headword" });
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("credits", "readwrite");
      tx.objectStore("credits").put({
        headword: "book",
        author: "Someone",
        licence: "cc0",
        licenceUrl: "https://example.invalid/licence",
        sourceUrl: "https://example.invalid/photo",
        at: Date.now(),
      });
      tx.oncomplete = () => db.close();
    };
  }, DATABASE_NAME);
}

async function hasDatabase(page: Page, name: string): Promise<boolean> {
  const databases = await page.evaluate(() => indexedDB.databases());
  return databases.some((entry) => entry.name === name);
}

test("a device carrying reading-credits forgets it after opening the app once", async ({ page }) => {
  await deleteTranslator(page);
  await seedPhotoCredits(page);

  const assetResponse = page.waitForResponse((response) => response.url().includes(manifest.asset.path) && response.ok());
  await page.goto("/");
  await assetResponse;

  await expect.poll(() => hasDatabase(page, DATABASE_NAME)).toBe(false);
});

test("a device with no reading-credits database never opens or creates one while it reaches a word's answer", async ({
  page,
}) => {
  await deleteTranslator(page);
  await page.addInitScript(() => {
    (window as unknown as { __openedDatabases: string[] }).__openedDatabases = [];
    const nativeOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = ((...args: Parameters<typeof indexedDB.open>) => {
      (window as unknown as { __openedDatabases: string[] }).__openedDatabases.push(args[0]);
      return nativeOpen(...args);
    }) as typeof indexedDB.open;
  });

  const assetResponse = page.waitForResponse((response) => response.url().includes(manifest.asset.path) && response.ok());
  await page.goto("/");
  await assetResponse;

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await searchBox.fill("throughout");
  await expect(page.getByRole("heading", { name: "throughout" })).toBeVisible({ timeout: 5000 });

  const openedDatabases = await page.evaluate(
    () => (window as unknown as { __openedDatabases: string[] }).__openedDatabases,
  );
  expect(openedDatabases).not.toContain("reading-credits");
  expect(await hasDatabase(page, "reading-credits")).toBe(false);
});

test("a second open of the same device issues no second delete request", async ({ page }) => {
  await deleteTranslator(page);
  await page.addInitScript((name) => {
    const nativeDelete = indexedDB.deleteDatabase.bind(indexedDB);
    indexedDB.deleteDatabase = ((deletedName: string) => {
      if (deletedName === name) {
        const count = Number(localStorage.getItem("e2e-delete-calls") ?? "0");
        localStorage.setItem("e2e-delete-calls", String(count + 1));
      }
      return nativeDelete(deletedName);
    }) as typeof indexedDB.deleteDatabase;
  }, DATABASE_NAME);

  const firstAsset = page.waitForResponse((response) => response.url().includes(manifest.asset.path) && response.ok());
  await page.goto("/");
  await firstAsset;
  await expect.poll(() => page.evaluate(() => localStorage.getItem("reading-credits-forgotten"))).toBe("1");

  const secondAsset = page.waitForResponse((response) => response.url().includes(manifest.asset.path) && response.ok());
  await page.goto("/");
  await secondAsset;
  await page.waitForTimeout(300);

  const deleteCalls = await page.evaluate(() => Number(localStorage.getItem("e2e-delete-calls") ?? "0"));
  expect(deleteCalls).toBe(1);
});

test("with indexedDB unreachable the search box appears with no console error", async ({ page }) => {
  await deleteTranslator(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
  });

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("/");

  const searchBox = page.getByRole("textbox", { name: messages.search.label });
  await expect(searchBox).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
