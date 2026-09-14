import "server-only";

import { env } from "@/lib/env";
import { notesResponseSchema, type PhraseNoteAnswer } from "@/lib/phrase/notes-protocol";

// RL-46's one model — the same choice `word/model.ts` made for RL-41/RL-42,
// on the same measured grounds (never a flagship, never "minimal" reasoning).
export const NOTES_MODEL_NAME = "gpt-5-nano";

const CHAT_COMPLETIONS_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const REASONING_EFFORT = "low";
// Measured on `black minorca pullets`: even at "low", reasoning alone spent
// 700-704 of a 700-token budget and left nothing for the JSON itself —
// `finish_reason: "length"`, empty content, an honest 204 for a call that
// had already answered correctly. This prompt's two hints and the
// three-note shape reason longer than `word/model.ts`'s single headword
// ever did; 1600 leaves headroom above the worst reasoning spend measured.
const MAX_OUTPUT_TOKENS = 1600;

type ChatCompletionsPayload = {
  choices?: Array<{ message?: { content?: string } }>;
};

// The two hints the server computes and hands over as hints, never as
// instructions — the contract's own example (`black minorca`) is the case
// neither hint touches, and only the model's read of the whole sentence
// resolves it.
function buildSystemPrompt(survivors: string[], unindexed: string[]): string {
  const hintLines: string[] = [];
  if (survivors.length > 0) {
    hintLines.push(
      `Source words that survive unchanged inside the translation: ${survivors.join(", ")}.`,
    );
  }
  if (unindexed.length > 0) {
    hintLines.push(
      `Source words this dictionary's own index carries no entry for: ${unindexed.join(", ")}.`,
    );
  }
  const hintBlock =
    hintLines.length > 0
      ? ` ${hintLines.join(" ")} Treat both as hints, not as a checklist: ignore either when the ` +
        `sentence's own context points to a different term, or to none at all.`
      : "";

  return (
    `You help a Spanish-speaking learner of English who already has an English sentence and its ` +
    `Spanish translation. Pick up to three terms from the English sentence that this reader would ` +
    `not recognise — a breed, a place, a custom, a thing — and write one short note in Spanish for ` +
    `each explaining what the thing is, never how the word translates: a note on "black minorca" ` +
    `says it is a chicken breed, not that "minorca" means "menorca".${hintBlock} Zero notes is a ` +
    `correct answer when nothing in the sentence needs one — never invent a term to fill three ` +
    `slots. Reply with strict JSON only, shaped exactly as ` +
    `{"notes": [{"term": string, "note": string}]}, at most 3 entries, "term" copied verbatim from ` +
    `the English sentence and "note" written in Spanish.`
  );
}

/**
 * One call, up to three notes. Never throws: any failure, at any step,
 * answers `null`, so the route's own 204 is the only way a bad generation
 * reaches a reader (mirrors `generateWordText`).
 */
export async function generateNotes(
  source: string,
  translation: string,
  survivors: string[],
  unindexed: string[],
): Promise<PhraseNoteAnswer[] | null> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const body = {
    model: NOTES_MODEL_NAME,
    reasoning_effort: REASONING_EFFORT,
    max_completion_tokens: MAX_OUTPUT_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt(survivors, unindexed) },
      { role: "user", content: `English: ${source}\nSpanish: ${translation}` },
    ],
  };

  let response: Response;
  try {
    response = await fetch(CHAT_COMPLETIONS_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let payload: ChatCompletionsPayload;
  try {
    payload = (await response.json()) as ChatCompletionsPayload;
  } catch {
    return null;
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;

  let parsedContent: unknown;
  try {
    parsedContent = JSON.parse(content);
  } catch {
    return null;
  }

  const result = notesResponseSchema.safeParse(parsedContent);
  return result.success ? result.data.notes : null;
}
