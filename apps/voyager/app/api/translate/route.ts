import { z } from "zod";

import { env } from "@/lib/env";
import type { TranslationResult } from "@/lib/translate/types";

// The word path never reaches this route (RL-09): it exists for the sentence
// path alone, and only when the device offers no translator of its own.
export const dynamic = "force-dynamic";

// Shared with `network.ts`, so the body a `fetch` sends is exactly the body
// this handler accepts — one schema, not two hand-kept in sync.
export const translateRequestSchema = z.object({
  text: z.string().min(1).max(1000),
});

// MyMemory's endpoint and language pair, the one constant a provider swap
// touches. English to Spanish is fixed for this slice; direction is not a
// parameter the route accepts.
const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";

type MyMemoryMatch = {
  translation?: string;
  quality?: string;
  match?: number;
};

type MyMemoryResponse = {
  responseData?: { translatedText?: string };
  responseStatus?: number | string;
  matches?: MyMemoryMatch[];
};

// MyMemory's quota-exhausted warning always starts with this: matched as a
// belt-and-braces check alongside `responseStatus`, in case a future warning
// ships a status this file has not seen.
const MYMEMORY_WARNING_PREFIX = "MYMEMORY WARNING";

// Trim, case-fold, and collapse inner whitespace — the differences a reader
// never notices between what they typed and what came back. Punctuation is
// left alone: a reader who typed a trailing "?" and got one back said
// something, even if the words never moved.
function foldForComparison(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

// MyMemory echoes a string it cannot place in either language straight
// back — gibberish included — with `responseStatus: "200"` and no warning:
// the two checks below never catch it. The same fold also refuses a proper
// noun, a brand name or a number that legitimately holds still across `en`
// and `es`; RL-37's per-word breakdown is what that reply lands on instead,
// an honest "could not answer" rather than a false badge.
function isEcho(source: string, translated: string): boolean {
  return foldForComparison(translated) === foldForComparison(source);
}

// The one gate both `responseData.translatedText` and every `matches` entry
// answer to: not empty, not the quota warning, not an echo of what was
// asked. A candidate that fails any of these said nothing, whichever field
// it came from.
function isUsableTranslation(source: string, candidate: string | undefined): candidate is string {
  return (
    typeof candidate === "string" &&
    candidate.length > 0 &&
    !candidate.toUpperCase().startsWith(MYMEMORY_WARNING_PREFIX) &&
    !isEcho(source, candidate)
  );
}

// MyMemory's top pick can come back empty — measured live for "the cat sat
// on the mat" — while `matches` still holds one that answers the sentence.
// Ranked by `match`, not by array position: the reply is not contractually
// sorted, and the highest-scoring usable entry is the one worth trusting.
function bestAlternativeTranslation(source: string, matches: MyMemoryMatch[] | undefined): string | undefined {
  let best: { translation: string; score: number } | undefined;
  for (const candidate of matches ?? []) {
    if (!isUsableTranslation(source, candidate.translation)) continue;
    const score = candidate.match ?? 0;
    if (!best || score > best.score) {
      best = { translation: candidate.translation, score };
    }
  }
  return best?.translation;
}

// The one function a provider swap replaces. MyMemory's anonymous tier caps
// at roughly 5,000 words a day per caller IP (10,000 once `de` names a
// registered email); past that cap it still answers HTTP 200, with
// `responseStatus` set to a non-200 value (`"160"`) and `translatedText`
// holding a warning sentence, not a translation. Both `responseStatus` and
// the warning's own prefix are checked, so that sentence never reaches a
// reader as though it answered what they typed — the client only ever sees
// a generic 502, never a rate-limit message to parse.
//
// A quota past the cap is a request-level failure and stops here, before
// `matches` is even read: `responseStatus` already said the whole reply is
// not to be trusted, so there is nothing in it worth falling back to.
//
// Below that, an unusable top pick is not the whole reply's failure — RL-49,
// measured live: MyMemory's best-scoring match for "the cat sat on the mat"
// is `translatedText: ""`, while a lower-scoring entry in `matches` answers
// the sentence in full. That array is checked with the same filter before
// this function gives up and lets the route answer 502.
async function translateWithProvider(text: string): Promise<string> {
  const params = new URLSearchParams({ q: text, langpair: "en|es" });
  if (env.TRANSLATE_MYMEMORY_EMAIL) params.set("de", env.TRANSLATE_MYMEMORY_EMAIL);
  if (env.TRANSLATE_MYMEMORY_KEY) params.set("key", env.TRANSLATE_MYMEMORY_KEY);

  const response = await fetch(`${MYMEMORY_ENDPOINT}?${params.toString()}`);
  if (!response.ok) {
    throw new Error("MyMemory responded with an error status");
  }

  const payload = (await response.json()) as MyMemoryResponse;
  if (String(payload.responseStatus) !== "200") {
    throw new Error("MyMemory reported a non-200 responseStatus");
  }

  const translated = payload.responseData?.translatedText;
  if (isUsableTranslation(text, translated)) {
    return translated;
  }

  const alternative = bestAlternativeTranslation(text, payload.matches);
  if (alternative) {
    return alternative;
  }

  throw new Error("MyMemory returned no usable translation");
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  const parsed = translateRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  try {
    const text = await translateWithProvider(parsed.data.text);
    const result: TranslationResult = { text, origin: "network" };
    return Response.json(result, { status: 200 });
  } catch {
    return Response.json({ error: "provider" }, { status: 502 });
  }
}
