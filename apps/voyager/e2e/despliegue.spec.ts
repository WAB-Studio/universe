import { expect, test } from "./fixtures";

// The one cache `sw.js` is allowed to hold. A name that drifts from the
// worker's own is a spec that measures nothing, so it is read back below
// from `caches.keys()` rather than only asserted against.
const CACHE_NAME = "reading-shell-v8";

// A chunk no build of this app will ever name, standing in for what a
// previous deploy left behind: `cacheFirst` writes every `/_next/static/`
// response and evicts none, so without a sweep this entry outlives every
// deploy on the device.
const STALE_CHUNK = "/_next/static/chunks/OLD-BUILD-CHUNK.js";

const BUILD_KEY = "/__shell-build";

// Chromium's built-in `Translator` hangs `availability()` forever
// (docs/TRAPS.md), which would stall every page load below.
async function deleteTranslator(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

async function cachedStaticPaths(page: import("@playwright/test").Page, cacheName: string): Promise<string[]> {
  return page.evaluate(async (name) => {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    return keys.map((request) => new URL(request.url).pathname);
  }, cacheName);
}

// A device carries one build at a time. The crash this guards against was
// measured on 2026-09-14: a shell cached before RL-28 still answered
// lookups from its own dictionary worker — `{query, exact, viaInflection}`,
// no `correction` — while today's `SenseList` read `answer.correction.length`
// and threw. Nothing in the app ever noticed, because every suite runs one
// build against an empty cache.
test("a deploy retires the previous build's chunks, and a re-open sweeps nothing twice", async ({ page }) => {
  await deleteTranslator(page);

  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20_000 });

  // `activate` deletes every cache but its own, so a device that opened an
  // older worker keeps no second pool beside this one.
  const names = await page.evaluate(() => caches.keys());
  expect(names, "one cache, named by the worker in hand").toEqual([CACHE_NAME]);

  // Plant the previous build: its leftover chunk, and the fingerprint the
  // shell that wrote it carried.
  await page.evaluate(
    async ({ cacheName, chunk, buildKey }) => {
      const cache = await caches.open(cacheName);
      await cache.put(chunk, new Response("// a build ago", { headers: { "content-type": "application/javascript" } }));
      await cache.put(buildKey, new Response(chunk));
    },
    { cacheName: CACHE_NAME, chunk: STALE_CHUNK, buildKey: BUILD_KEY },
  );
  expect(await cachedStaticPaths(page, CACHE_NAME)).toContain(STALE_CHUNK);

  // One open of "/" is the whole trigger: the shell that arrives names a
  // different set of scripts, so everything under the old fingerprint goes.
  await page.goto("/");
  await expect
    .poll(async () => (await cachedStaticPaths(page, CACHE_NAME)).includes(STALE_CHUNK), { timeout: 15_000 })
    .toBe(false);

  const swept = await cachedStaticPaths(page, CACHE_NAME);
  expect(swept.filter((path) => path.startsWith("/_next/static/")).length, "this build's own chunks are back").toBeGreaterThan(0);

  // And the sweep is not a treadmill: a second open of the same build finds
  // its own fingerprint and leaves every entry where it is.
  const fingerprint = await page.evaluate(
    async ({ cacheName, buildKey }) => (await (await caches.open(cacheName)).match(buildKey))?.text() ?? null,
    { cacheName: CACHE_NAME, buildKey: BUILD_KEY },
  );
  expect(fingerprint, "the live shell's own script names").not.toBeNull();

  const before = (await cachedStaticPaths(page, CACHE_NAME)).filter((path) => path.startsWith("/_next/static/"));
  await page.goto("/");
  await page.waitForTimeout(2000);
  const after = (await cachedStaticPaths(page, CACHE_NAME)).filter((path) => path.startsWith("/_next/static/"));
  // A superset, not an equality: a second open still asks for a chunk the
  // first one never reached, and `cacheFirst` writes it. What must not
  // happen is a deletion — the sweep fires only on a fingerprint that moved.
  expect(after.filter((path) => before.includes(path)).sort(), "a matching fingerprint deletes nothing").toEqual(
    [...before].sort(),
  );
});
