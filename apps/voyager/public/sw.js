// Hand-written, no build step (RL-16). Bump this by hand on every change: it
// names the one cache the app is allowed to hold, and `activate` deletes any
// other cache it finds under this origin.
//
// v7 held assets from every deploy since 2026-09-07, because a deploy changes
// no byte of this file and so installs no new worker: nothing ever ran
// `activate` again, and `cacheFirst` never evicts. A device that opened the
// app on 2026-09-10 still carried that build's dictionary worker, whose
// `lookupWord` answered `{query, exact, viaInflection}` with no `correction`
// — the field `sense-list.tsx` has read since RL-28 (#157). Bumping the name
// is what drops that pool; `SHELL_BUILD` below is what keeps a later deploy
// from rebuilding it.
const CACHE_NAME = "reading-shell-v8";

// The shell the cache is allowed to hold, read off the current `/` every time
// the network answers one. A deploy changes the hashed script names in that
// HTML, so a mismatch is a new build and every `_next/static` entry under the
// old one goes — the reader's next open loads one build, never two.
const SHELL_BUILD_KEY = "/__shell-build";

// How long a navigation waits for the network before it falls back to the
// cached shell. Short enough that a dead connection does not stall the box.
const NAVIGATION_TIMEOUT_MS = 3000;

// This app has three pages (SPEC §page list): "/", "/registro" and
// "/cuenta". All three are precached at install so each opens offline on its
// own, never only as a side effect of having been visited online first — a
// bookmark, or a link into "/cuenta" that lands before "/" ever loaded, must
// still draw the app's own screen, not the browser's error page.
const SHELL_ROUTES = ["/", "/registro", "/cuenta"];

// Both routes call `getReader()` on the server and let a signed-in render
// draw more than a signed-out one does: "/cuenta" bakes the email itself
// into the markup, "/registro" bakes which actions its confirm panel
// offers (`ClearPanel`'s `hasReader` — the account wipe only ever draws for
// a reader with a session, since it calls `DELETE /api/log/clear`, which a
// session-less request always refuses). A cached copy of either signed-in
// render, replayed after the cookie is gone, hands the next person on the
// device the previous reader's own state straight out of Cache Storage —
// an email for "/cuenta", a button that always 401s for "/registro". So
// both cache entries are written exactly once, with credentials withheld
// (see `install`), and `navigate` below never overwrites either — not with
// a signed-in render, not with any other.
const NO_OVERWRITE_ROUTES = new Set(["/cuenta", "/registro"]);

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // `cache.add` rejects on anything but a 2xx; a `fetch` + `put` takes whatever
  // status each route answers with, so an install never fails on one of them.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL_ROUTES.map((route) => {
          // Omitting credentials for "/cuenta" forces the signed-out render
          // even when the tab installing the worker happens to hold a
          // session — the one copy this cache ever takes of it must be safe
          // to hand to a stranger.
          const init = NO_OVERWRITE_ROUTES.has(route) ? { credentials: "omit" } : undefined;
          return fetch(route, init).then((response) => cache.put(route, response));
        }),
      ),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

function rejectAfter(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error("navigation timed out")), ms);
  });
}

// The hashed script names the live "/" carries. Every one of them changes on a
// deploy, so this string is the build's own name — read off the shell itself,
// which costs no request and needs no build step (RL-16).
async function shellBuild(response) {
  const html = await response.text();
  const scripts = html.match(/\/_next\/static\/[^"']+?\.js/g);
  return scripts === null ? null : Array.from(new Set(scripts)).sort().join(",");
}

// Everything under `/_next/static/` belongs to exactly one build, and
// `cacheFirst` never evicts: without this, a device keeps every build it has
// ever opened. A stale shell then draws today's chunks alongside its own, and
// the two disagree — measured 2026-09-14, a shell from before RL-28 handed
// today's `SenseList` an answer with no `correction` and the screen threw.
// One build's chunks at a time, retired the moment "/" names another set.
async function retireOtherBuilds(cache, response) {
  const build = await shellBuild(response);
  if (build === null) return;
  const stored = await cache.match(SHELL_BUILD_KEY);
  if (stored && (await stored.text()) === build) return;
  const keys = await cache.keys();
  await Promise.all(
    keys
      .filter((request) => new URL(request.url).pathname.startsWith("/_next/static/"))
      .map((request) => cache.delete(request)),
  );
  await cache.put(SHELL_BUILD_KEY, new Response(build));
}

// Keyed by the request itself (its own URL), one entry per route: a hard
// load of "/registro" must never overwrite the cached "/" shell, or an
// offline open of "/" would serve the study instead of the search box. Also
// keeps SHELL_ROUTES fresh with whatever the network last answered, so a
// precached route never goes stale once it has been visited online — except
// the two `NO_OVERWRITE_ROUTES`, whose live render may carry a session this
// cache must never hold: the network still answers each of them every time,
// the response just never gets written back.
async function navigate(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const path = new URL(request.url).pathname;
  try {
    const response = await Promise.race([fetch(request), rejectAfter(NAVIGATION_TIMEOUT_MS)]);
    if (!NO_OVERWRITE_ROUTES.has(path)) cache.put(request, response.clone());
    // "/" alone: every page names a different set of chunks, so only one
    // route can stand for the build without reading a change into a move
    // between screens. It is also the route a reader opens first.
    // Held open past the response rather than awaited before it: the reader
    // waits for the screen, never for the cache to be swept.
    if (path === "/") event.waitUntil(retireOtherBuilds(cache, response.clone()));
    return response;
  } catch {
    const shell = await cache.match(request);
    if (shell) return shell;
    throw new Error("offline, no cached shell");
  }
}

// Content-hashed and immutable: a cache hit is never stale, so there is no
// reason to ever ask the network again once one is stored.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // The dictionary payload lives in IndexedDB (lib/dictionary), installed by
  // another module once. Caching it here too would put a second 8.2 MB copy
  // in Cache Storage on the device, for nothing.
  if (url.pathname.startsWith("/dictionary/")) return;

  // The app's only server surface. A stale translation is worse than none, so
  // this route is never intercepted, cached, or answered while offline.
  if (url.pathname === "/api/translate") return;

  // Uploads a batch of already-synced rows. A cached response here would
  // replay rows the server already has, never send the ones it does not.
  if (url.pathname === "/api/log/sync") return;

  // Lands the magic link and sets the session cookie. A cached response
  // sets no cookie, so the sign-in would silently fail.
  if (url.pathname.startsWith("/auth/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(navigate(event.request, event));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Anything else: let the browser's own fetch happen, uncached.
});
