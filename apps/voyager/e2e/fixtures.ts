import { test as base, expect } from "@playwright/test";

// `/api/word/text` calls the model and spends the user's own OpenAI money;
// `/api/word/photo` writes a `reading.word_photos` row and a bucket object
// nothing expires; `/api/word/unlisted` and `/api/phrase/notes` are the same
// kind of paid, cached route for RL-44/RL-47 and RL-46. Every spec in this
// suite gets all four routes intercepted and answered deterministically by
// default — importing `test`/`expect` from here, instead of
// `@playwright/test` directly, is what turns the interception on. A spec
// that needs a real route says so through `allowRealWordRoute` below, with a
// reason, in its own comment.
type WordRouteName = "text" | "photo" | "unlisted" | "notes";

type WordTextBody = { definition: string | null; example: { en: string; es: string } };

type UnlistedBody = {
  translations: string[];
  definition: string | null;
  example: { en: string; es: string };
  lemma: string | null;
  rule: string | null;
};

type PhraseNotesBody = { notes: Array<{ term: string; note: string }> };

// Tags every response this file fabricates, so the watchdog below can tell
// "a stub answered" from "the real route answered" without trusting that
// every caller remembered to opt in — the same gap `OPENAI_API_KEY=""`
// left, as a convention rather than a guard.
const STUB_HEADER = "x-e2e-word-stub";

// Each route is a single POST with no subpath; the photo GET that serves
// bucket bytes shares its pathname with the POST that requests it, so
// matching on pathname alone — ignoring `?headword=...` — catches every
// request either verb makes, with nothing left over to match separately.
function wordRouteName(url: URL): WordRouteName | null {
  if (url.pathname === "/api/word/text") return "text";
  if (url.pathname === "/api/word/photo") return "photo";
  if (url.pathname === "/api/word/unlisted") return "unlisted";
  if (url.pathname === "/api/phrase/notes") return "notes";
  return null;
}

type WordRouteState = {
  opted: Set<WordRouteName>;
  textBody: WordTextBody | null;
  unlistedBody: UnlistedBody | null;
  phraseNotesBody: PhraseNotesBody | null;
};

type WordRouteFixtures = {
  wordRouteState: WordRouteState;
  // Lets the rest of a test's own body reach the real route for one of the
  // four endpoints. `reason` must say why; an empty one throws, so a caller
  // cannot opt out silently.
  allowRealWordRoute(route: WordRouteName, reason: string): Promise<void>;
  // Replaces the default absent (204) text answer with a generated one —
  // still fully mocked, never the real route.
  stubWordText(body: WordTextBody): Promise<void>;
  // Same shape as `stubWordText`, for `/api/word/unlisted` (RL-44, RL-47).
  stubUnlisted(body: UnlistedBody): Promise<void>;
  // Same shape as `stubWordText`, for `/api/phrase/notes` (RL-46).
  stubPhraseNotes(body: PhraseNotesBody): Promise<void>;
};

export const test = base.extend<WordRouteFixtures>({
  // Named `provide`, not Playwright's own `use`: an identically-named
  // parameter here reads to `eslint-plugin-react-hooks` as the `use` hook,
  // which this file, being test wiring rather than a component, is not.
  wordRouteState: async ({}, provide) => {
    await provide({ opted: new Set(), textBody: null, unlistedBody: null, phraseNotesBody: null });
  },

  // Overriding the built-in `context`, not `page`: `log.spec.ts` opens
  // further pages with `context.newPage()`, and those must stay caught
  // too. `page` is Playwright's own child of this context, so it inherits
  // the routing below with nothing extra wired here.
  context: async ({ context, wordRouteState }, provide) => {
    const escapes: string[] = [];

    await context.route(
      (url) => wordRouteName(url) !== null,
      (route) => {
        const name = wordRouteName(new URL(route.request().url()))!;
        if (wordRouteState.opted.has(name)) {
          void route.continue();
          return;
        }
        const fabricated =
          name === "text"
            ? wordRouteState.textBody
            : name === "unlisted"
              ? wordRouteState.unlistedBody
              : name === "notes"
                ? wordRouteState.phraseNotesBody
                : null;
        if (fabricated) {
          void route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { [STUB_HEADER]: "1" },
            body: JSON.stringify(fabricated),
          });
          return;
        }
        // RL-35's absent shape: no connection, no provider, no cap left —
        // the same screen every route already draws with nothing to show.
        void route.fulfill({ status: 204, headers: { [STUB_HEADER]: "1" } });
      },
    );

    // The provable half of the default: every response either route ever
    // gives, in this context or a page it opens, is checked here — not
    // just assumed to have gone through the handler above. A response
    // opted into is real on purpose; one carrying neither the opt-in nor
    // this file's own marker reached the real route some other way, which
    // is exactly the gap `allowRealWordRoute` exists to close on purpose
    // instead of by accident.
    context.on("response", (response) => {
      const name = wordRouteName(new URL(response.url()));
      if (!name || wordRouteState.opted.has(name)) return;
      if (response.headers()[STUB_HEADER] === "1") return;
      escapes.push(`${response.request().method()} ${response.url()} -> ${response.status()}`);
    });

    await provide(context);

    if (escapes.length > 0) {
      throw new Error(
        "a word or phrase route escaped the default interception, reaching the real server:\n" +
          escapes.join("\n") +
          "\nOpt in with allowRealWordRoute() and say why, or fix the stub.",
      );
    }
  },

  allowRealWordRoute: async ({ wordRouteState }, provide) => {
    await provide(async (route, reason) => {
      if (!reason.trim()) throw new Error("allowRealWordRoute needs a reason");
      wordRouteState.opted.add(route);
    });
  },

  stubWordText: async ({ wordRouteState }, provide) => {
    await provide(async (body) => {
      wordRouteState.textBody = body;
    });
  },

  stubUnlisted: async ({ wordRouteState }, provide) => {
    await provide(async (body) => {
      wordRouteState.unlistedBody = body;
    });
  },

  stubPhraseNotes: async ({ wordRouteState }, provide) => {
    await provide(async (body) => {
      wordRouteState.phraseNotesBody = body;
    });
  },
});

export { expect };
