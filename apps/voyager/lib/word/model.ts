import "server-only";

import { env } from "@/lib/env";
import { textResponseSchema, type WordText } from "@/lib/word/protocol";

// RL-41/RL-42's one model, decided by the user 2026-09-10 over `minimal`
// (4.4x cheaper, but invented `abies` as a form of a young tree instead of
// the fir genus) and over `gpt-4.1-nano` (returned the bare headword where a
// translation was asked for, in 12 of 12). Never a flagship: one `gpt-5.5`
// call bought nothing a measurement had not already said.
export const MODEL_NAME = "gpt-5-nano";

const CHAT_COMPLETIONS_ENDPOINT = "https://api.openai.com/v1/chat/completions";

// Measured 2026-09-10: left unset, 83% of the output tokens went to
// reasoning — 2,695 output tokens for 12 words instead of ~600. Never
// unset, never "minimal" for this task.
const REASONING_EFFORT = "low";

// RL-45's "translations" field pushes this model's own reasoning past 700 on
// 3 of 4 tries against `snuff` — `finish_reason: "length"`, the whole budget
// spent on reasoning and none on content, so the JSON truncates to nothing
// and the call answers null. At 2000 every try finishes, reasoning between
// 320 and 960, and a word that is not thin still spends only 193 to 321.
const MAX_OUTPUT_TOKENS = 2000;

type ChatCompletionsPayload = {
  choices?: Array<{ message?: { content?: string } }>;
};

// RL-45's ask, folded into the one prompt: `existingTranslations` null means
// the entry was never thin and none is wanted; an array (even empty) is
// what the dictionary already lists, asked to be completed rather than
// repeated.
function buildTranslationsInstruction(headword: string, existingTranslations: readonly string[] | null): string {
  if (existingTranslations === null) {
    return `Set "translations" to null: this headword's dictionary entry is not thin.`;
  }
  if (existingTranslations.length === 0) {
    return (
      `Set "translations" to an array of Spanish translations for "${headword}", most common ` +
      `use first. An empty array if you find none.`
    );
  }
  return (
    `The dictionary already lists these Spanish translations for "${headword}": ` +
    `${existingTranslations.join(", ")}. Set "translations" to an array of the ones it is ` +
    `missing, most common use first, never repeating one already listed. An empty array if you ` +
    `find none.`
  );
}

function buildSystemPrompt(
  headword: string,
  wantDefinition: boolean,
  existingTranslations: readonly string[] | null,
): string {
  const definitionInstruction = wantDefinition
    ? `Write "definition" as one concise English sentence defining "${headword}", in a dictionary's own register.`
    : `Set "definition" to null: this headword already has one.`;
  return (
    `You extend an English-Spanish learner's dictionary. Reply with strict JSON only, shaped ` +
    `exactly as {"definition": string|null, "example": {"en": string, "es": string}, ` +
    `"translations": string[]|null}. "example.en" is one natural English sentence that uses ` +
    `"${headword}". "example.es" is its Spanish translation. ${definitionInstruction} ` +
    `${buildTranslationsInstruction(headword, existingTranslations)}`
  );
}

/**
 * One call, definition, example and (RL-45) translations together — the
 * shape measured against twelve entries with no definition. The route also
 * calls this with `wantDefinition` false and a cached example already on
 * hand, purely for `translations`; the example it returns then is spent
 * tokens, never written back over the cached one. Never throws: any
 * failure, at any step, answers `null`, so the route's own 204 is the only
 * way a bad generation reaches a reader. Endpoint and parameter names
 * verified with a real call this session: `/v1/chat/completions` takes
 * `max_completion_tokens`, not `max_tokens`, and a top-level
 * `reasoning_effort`; driving this function below confirms both still hold.
 */
export async function generateWordText(
  headword: string,
  wantDefinition: boolean,
  existingTranslations: readonly string[] | null,
): Promise<WordText | null> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const body = {
    model: MODEL_NAME,
    reasoning_effort: REASONING_EFFORT,
    max_completion_tokens: MAX_OUTPUT_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt(headword, wantDefinition, existingTranslations) },
      { role: "user", content: `Headword: ${headword}` },
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

  const result = textResponseSchema.safeParse(parsedContent);
  return result.success ? result.data : null;
}
