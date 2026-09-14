import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { normaliseHeadword } from "@/lib/dictionary/format";
import type { DictionaryPayload } from "@/lib/dictionary/format";
import { buildIndex, groupFor, type DictionaryIndex } from "@/lib/dictionary/index-build";
import { env } from "@/lib/env";
import { claimClientCall, clientKey } from "@/lib/word/client-budget";
import { claimDailyCall } from "@/lib/word/spend";
import { generateNotes, NOTES_MODEL_NAME } from "@/lib/phrase/notes-model";
import { phraseHash, readCachedNotes, writeCachedNotes } from "@/lib/phrase/notes-cache";
import { admitPhrase, notesRequestSchema, notesResponseSchema, tokenisePhrase } from "@/lib/phrase/notes-protocol";

// This is the first route in the app that sends a reader's own free text to
// a paid provider (every earlier one sends a headword `admitWord` already
// closed, or a caller-chosen but dictionary-listed string). Its gate and its
// budget are written here because nothing upstream of this file has ever
// had to earn either.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function empty(status: 204 | 400): Response {
  return new Response(null, { status, headers: NO_STORE });
}

const DICTIONARY_ASSET = path.join(
  process.cwd(),
  "public",
  "dictionary",
  "eng-spa-2025.11.23.json",
);

// Read once per server process, the same asset `word/text/route.ts` loads —
// this route's own "does the index have it" hint reads from it, it never
// gates admission (a phrase of real-shaped words is admitted whether or not
// the dictionary carries every one of them).
let dictionaryIndex: DictionaryIndex | null = null;

function loadDictionaryIndex(): DictionaryIndex {
  if (!dictionaryIndex) {
    const payload = JSON.parse(readFileSync(DICTIONARY_ASSET, "utf8")) as DictionaryPayload;
    dictionaryIndex = buildIndex(payload);
  }
  return dictionaryIndex;
}

// A source token survives translation when the exact same spelling still
// appears as a whole word inside the translation — `frisking` staying
// `frisking` rather than becoming a Spanish verb. Case-insensitive: the
// model capitalising a proper noun differently is not a different word.
function survivingTokens(sourceTokens: string[], translation: string): string[] {
  const translationWords = new Set(tokenisePhrase(translation).map((word) => word.toLowerCase()));
  return sourceTokens.filter((token) => translationWords.has(token.toLowerCase()));
}

function unindexedTokens(index: DictionaryIndex, sourceTokens: string[]): string[] {
  return sourceTokens.filter((token) => groupFor(index, normaliseHeadword(token)) === null);
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid" }, 400);
  }

  const parsed = notesRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid" }, 400);
  }

  const sourceTokens = admitPhrase(parsed.data.source, parsed.data.translation);
  if (!sourceTokens) {
    return json({ error: "invalid" }, 400);
  }

  // The clear phrase never reaches storage: only its hash does, from here
  // on. A cache hit answers with no budget spent and no model reached,
  // whatever the caps below say.
  const hash = phraseHash(parsed.data.source, parsed.data.translation);
  const cached = await readCachedNotes(hash);
  if (cached) {
    return json(notesResponseSchema.parse({ notes: cached }), 200);
  }

  // Absence is one shape everywhere: no key configured, no cap configured,
  // no chargeable client, over either cap, a provider failure, or a
  // generation that fails to validate all answer `204` — the same
  // "no connection" screen already drawn (RL-35).
  if (!env.OPENAI_API_KEY || !env.PHRASE_NOTES_DAILY_CALL_CAP || !env.PHRASE_NOTES_DAILY_CLIENT_CAP) {
    return empty(204);
  }

  // A budget nobody can charge is a budget that does not exist
  // (`client-budget.ts`): with no `CLIENT_KEY_SALT` configured, `clientKey`
  // reads `null` for every caller and this route never reaches the model.
  const client = clientKey(request);
  if (!client) {
    return empty(204);
  }

  // The same `reading.client_spend` row `/api/word/unlisted` bumps for this
  // caller, read against this route's own ceiling — never against
  // WORD_UNLISTED_DAILY_CLIENT_CAP, and never left unread the way it was.
  const clientCalls = await claimClientCall(client);
  if (clientCalls > env.PHRASE_NOTES_DAILY_CLIENT_CAP) {
    return empty(204);
  }

  // Sequential, not `Promise.all` with the claim above: both are writes
  // that bump a counter, and run in parallel the second one climbs even
  // when the first should already have refused the request.
  const calls = await claimDailyCall();
  if (calls > env.PHRASE_NOTES_DAILY_CALL_CAP) {
    return empty(204);
  }

  const index = loadDictionaryIndex();
  const survivors = survivingTokens(sourceTokens, parsed.data.translation);
  const unindexed = unindexedTokens(index, sourceTokens);

  const notes = await generateNotes(parsed.data.source, parsed.data.translation, survivors, unindexed);
  if (!notes) {
    return empty(204);
  }

  await writeCachedNotes(hash, NOTES_MODEL_NAME, notes);

  return json(notesResponseSchema.parse({ notes }), 200);
}
