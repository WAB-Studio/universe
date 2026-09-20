/**
 * Drives `app/api/translate/route.ts`'s `POST` handler directly, with
 * `global.fetch` stubbed to answer as MyMemory does — never the real
 * endpoint, whose anonymous quota is shared and capped.
 *
 * Proves the one branch the route did not have: a reply identical to the
 * request, once folded, is refused exactly like an empty `translatedText`
 * or a quota warning already were. Every prior branch is re-run too, so
 * this file stands as the route's only regression cover, not only the new
 * line's.
 *
 * Also proves RL-49: an empty `translatedText` alongside a usable `matches`
 * entry is answered from that entry, not refused. The stub for that case is
 * the real reply measured with `curl` against `api.mymemory.translated.net`
 * for "the cat sat on the mat", trimmed to the fields this route reads.
 */
import { POST } from "../app/api/translate/route";

let failed = false;

function assert(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (!ok) failed = true;
}

type MyMemoryMatchStub = { translation?: string; quality?: string; match?: number };

type MyMemoryStub = {
  responseData?: { translatedText?: string };
  responseStatus?: number | string;
  matches?: MyMemoryMatchStub[];
};

function stubFetch(payload: MyMemoryStub, ok = true): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), { status: ok ? 200 : 500 })) as typeof fetch;
}

async function postTranslate(text: string): Promise<{ status: number; body: unknown }> {
  const request = new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const response = await POST(request);
  return { status: response.status, body: await response.json() };
}

async function main() {
  // A genuine translation still passes: the fold never touches two strings
  // that actually differ.
  stubFetch({ responseData: { translatedText: "Me fui de mi casa ayer" }, responseStatus: 200 });
  const genuine = await postTranslate("I left my house yesterday");
  assert(
    "a real translation still passes",
    genuine.status === 200 && (genuine.body as { text: string }).text === "Me fui de mi casa ayer",
    JSON.stringify(genuine),
  );

  // The defect as measured: gibberish MyMemory cannot place in either
  // language comes back unchanged, `responseStatus: "200"`, no warning.
  stubFetch({ responseData: { translatedText: "zzz qqq" }, responseStatus: 200 });
  const gibberish = await postTranslate("zzz qqq");
  assert("byte-identical gibberish is refused", gibberish.status === 502, JSON.stringify(gibberish));

  // Trim and case-fold: the comparison this route now makes. A reply that
  // differs from the request only in case or in outer whitespace answered
  // nothing either.
  stubFetch({ responseData: { translatedText: "  ZZZ   QQQ  " }, responseStatus: 200 });
  const foldedEcho = await postTranslate("zzz qqq");
  assert(
    "an echo that only differs in case or spacing is refused too",
    foldedEcho.status === 502,
    JSON.stringify(foldedEcho),
  );

  // The known cost: a name that legitimately holds still across English and
  // Spanish reads exactly like an echo, and is refused the same way. RL-37
  // hands this to the per-word breakdown instead of the network badge —
  // an honest "could not answer", not a wrong one.
  stubFetch({ responseData: { translatedText: "Harry Potter" }, responseStatus: 200 });
  const properNoun = await postTranslate("Harry Potter");
  assert(
    "a proper noun that translates to itself pays the same refusal (known cost)",
    properNoun.status === 502,
    JSON.stringify(properNoun),
  );

  // The two branches this route already had, both still standing.
  stubFetch({ responseData: { translatedText: "" }, responseStatus: 200 });
  const empty = await postTranslate("something to translate");
  assert("an empty translatedText is still refused", empty.status === 502, JSON.stringify(empty));

  stubFetch({ responseData: { translatedText: "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS" }, responseStatus: "160" });
  const quota = await postTranslate("something to translate");
  assert("a quota warning is still refused", quota.status === 502, JSON.stringify(quota));

  // RL-49, the defect as measured: MyMemory's best-scoring match for "the
  // cat sat on the mat" carries `translatedText: ""`, but `matches` holds a
  // second entry that actually answers the sentence. This is that exact
  // reply, trimmed to the fields the route reads.
  stubFetch({
    responseData: { translatedText: "" },
    responseStatus: 200,
    matches: [
      { translation: "", quality: "100", match: 0.99 },
      { translation: "El gato se sentó en la alfombra", quality: "74", match: 0.98 },
      { translation: "El gato se sentó en la alfombra.", quality: "74", match: 0.97 },
    ],
  });
  const catOnTheMat = await postTranslate("the cat sat on the mat");
  assert(
    "an empty main translation falls back to a usable match",
    catOnTheMat.status === 200 &&
      (catOnTheMat.body as { text: string }).text === "El gato se sentó en la alfombra",
    JSON.stringify(catOnTheMat),
  );

  // No usable alternative anywhere in `matches` — the route still refuses,
  // exactly as it did before this fix.
  stubFetch({
    responseData: { translatedText: "" },
    responseStatus: 200,
    matches: [
      { translation: "", match: 0.9 },
      { translation: "the cat sat on the mat", match: 0.5 },
    ],
  });
  const noAlternative = await postTranslate("the cat sat on the mat");
  assert(
    "an empty main translation with no usable match is still refused",
    noAlternative.status === 502,
    JSON.stringify(noAlternative),
  );

  // A quota warning landing inside a match (never seen live, only guarded
  // against) is skipped by the same filter the main translation answers to,
  // and the fallback keeps looking past it.
  stubFetch({
    responseData: { translatedText: "" },
    responseStatus: 200,
    matches: [
      { translation: "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS", match: 0.99 },
      { translation: "Traducción alterna válida", match: 0.5 },
    ],
  });
  const warningInMatch = await postTranslate("something to translate");
  assert(
    "a warning string inside matches is skipped, not handed to the reader",
    warningInMatch.status === 200 &&
      (warningInMatch.body as { text: string }).text === "Traducción alterna válida",
    JSON.stringify(warningInMatch),
  );

  // "Best" is the highest-scoring usable match, not the first one in the
  // array — the fallback must not lean on MyMemory's own ordering.
  stubFetch({
    responseData: { translatedText: "" },
    responseStatus: 200,
    matches: [
      { translation: "Peor opción", match: 0.4 },
      { translation: "Mejor opción", match: 0.9 },
    ],
  });
  const bestScoring = await postTranslate("something to translate");
  assert(
    "the fallback picks the highest-scoring usable match, not the first one",
    bestScoring.status === 200 && (bestScoring.body as { text: string }).text === "Mejor opción",
    JSON.stringify(bestScoring),
  );

  // A non-200 `responseStatus` is refused **by that check alone**. The quota
  // case above passes this line too, but it also carries the warning prefix,
  // so it dies in `isUsableTranslation` and says nothing about the guard.
  // Written 2026-09-19 after a mutant deleted the `responseStatus` guard
  // whole and this suite stayed green: any non-200 reply whose text merely
  // reads like a translation would have reached the reader as one.
  stubFetch({
    responseData: { translatedText: "Una frase que parece una traducción" },
    responseStatus: "429",
    matches: [{ translation: "Otra que también lo parece", match: 0.99 }],
  });
  const plainNon200 = await postTranslate("something to translate");
  assert(
    "a non-200 responseStatus is refused even when its text looks like a translation",
    plainNon200.status === 502,
    JSON.stringify(plainNon200),
  );

  // Two usable matches at the same score: the first one wins. The tie is the
  // only part of the ranking the suite did not exercise, so `>` could become
  // `>=` unnoticed and the comment above it stop being true.
  stubFetch({
    responseData: { translatedText: "" },
    responseStatus: 200,
    matches: [
      { translation: "La primera de dos iguales", match: 0.9 },
      { translation: "La segunda de dos iguales", match: 0.9 },
    ],
  });
  const tie = await postTranslate("something to translate");
  assert(
    "a tie in score keeps the first usable match, not the last",
    tie.status === 200 && (tie.body as { text: string }).text === "La primera de dos iguales",
    JSON.stringify(tie),
  );

  process.exit(failed ? 1 : 0);
}

void main();
