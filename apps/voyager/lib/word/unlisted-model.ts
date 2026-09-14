import "server-only";

import { z } from "zod";

import { env } from "@/lib/env";
import { MODEL_NAME } from "@/lib/word/model";

const CHAT_COMPLETIONS_ENDPOINT = "https://api.openai.com/v1/chat/completions";

// `reasoning_effort: "low"` is `lib/word/model.ts`'s choice, but not its
// 700-token cap: that one covers two fields, and this route asks a third
// while reasoning about a word it has no entry for. "coccidiosis" spends 576
// reasoning tokens and "swishing" 1,024, so at 700 or 1,000 the whole budget
// goes to reasoning and the call returns empty on `finish_reason: "length"`.
const REASONING_EFFORT = "low";
const MAX_OUTPUT_TOKENS = 2000;

// What the model itself must produce. `lemma`/`rule` are never asked for —
// `lookupWord` already knows them, and asking the model to echo them back
// is one more way for it to invent an answer instead of translating one.
const modelAnswerSchema = z.object({
  translations: z.array(z.string().min(1)).min(1),
  definition: z.string().min(1).nullable(),
  example: z.object({
    en: z.string().min(1),
    es: z.string().min(1),
  }),
});
type ModelAnswer = z.infer<typeof modelAnswerSchema>;

type ChatCompletionsPayload = {
  choices?: Array<{ message?: { content?: string } }>;
};

export type UnlistedInflection = { lemma: string; rule: string };

function buildSystemPrompt(word: string, inflection: UnlistedInflection | null): string {
  const shape =
    'Reply with strict JSON only, shaped exactly as ' +
    '{"translations": string[], "definition": string|null, "example": {"en": string, "es": string}}.';
  if (inflection) {
    // The lemma is context, never the answer: the reader typed the form, and
    // a translation of "swish" where they typed "swishing" is the wrong word.
    return (
      `You extend an English-Spanish learner's dictionary. The word "${word}" is not a headword ` +
      `itself: it is the headword "${inflection.lemma}" inflected. ${shape} "translations" holds ` +
      `one or more Spanish translations of "${word}" exactly as written — in its own tense and ` +
      `number, never the lemma's dictionary form. Set "definition" to null: a form is not defined ` +
      `on its own. "example.en" is one natural English sentence that uses "${word}" exactly as ` +
      `written. "example.es" is its Spanish translation.`
    );
  }
  return (
    `You extend an English-Spanish learner's dictionary. "${word}" has no entry in it at all. ` +
    `${shape} "translations" holds one or more Spanish translations of "${word}", most common ` +
    `first. "definition" is one concise English sentence defining "${word}", in a dictionary's ` +
    `own register. "example.en" is one natural English sentence that uses "${word}". "example.es" ` +
    `is its Spanish translation.`
  );
}

/**
 * Never throws: any failure, at any step, answers `null`, so the route's own
 * 204 is the only way a bad generation reaches a reader — the same contract
 * `generateWordText` (`lib/word/model.ts`) keeps for the text route.
 */
export async function generateUnlistedAnswer(
  word: string,
  inflection: UnlistedInflection | null,
): Promise<ModelAnswer | null> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const body = {
    model: MODEL_NAME,
    reasoning_effort: REASONING_EFFORT,
    max_completion_tokens: MAX_OUTPUT_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt(word, inflection) },
      { role: "user", content: `Word: ${word}` },
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

  const result = modelAnswerSchema.safeParse(parsedContent);
  if (!result.success) return null;
  // A form's definition is never the model's to give: forced null here too,
  // so a prompt the model ignored can never smuggle one into the response.
  return inflection ? { ...result.data, definition: null } : result.data;
}
