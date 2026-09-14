import { useTranslations } from "next-intl";

import { Box, Flex, Separator, Text, VisuallyHidden } from "@/components/ui";
import type { WordText } from "@/lib/word/protocol";

// The three shapes module 9's hook resolves a word's decoration to. State
// in, DOM out: this file makes no request of its own.
export type GeneratedTextState =
  | { kind: "pending" }
  | { kind: "resolved"; text: WordText }
  | { kind: "absent" };

// A generated definition and example, marked apart from the dictionary's own
// (docs/voyager/DESIGN.md "Generated text is marked «generada»" — a model
// mis-defined `abies` in a test of twelve, and the reader has no way to
// doubt a line that looks like every other one).
export function GeneratedText({ state }: { state: GeneratedTextState }) {
  const t = useTranslations("word");

  // `PalabraSinDefinicionOscuroMovil`: no connection, no result, or the
  // daily ceiling reached all read as exactly today's screen — no hairline,
  // no hole, no apology. This is the case RL-41 decorates under RL-35.
  if (state.kind === "absent") return null;

  if (state.kind === "pending") {
    // `PalabraGenerandoOscuroMovil`: the answer above is already whole and
    // waits for nobody (RL-35); this block only holds its own place, no
    // spinner and no «generada» tag — there is nothing generated yet to mark.
    return (
      <Flex direction="column" data-generated-block="">
        <Separator size="4" />
        <Box pt="2" pb="1">
          <Text variant="pendingHint" serif muted>
            {t("definitionGenerating")}
          </Text>
        </Box>
        <Separator size="4" />
      </Flex>
    );
  }

  const { text } = state;
  // `text.definition` is null both for the 19.7% the dictionary has no
  // entry for (RL-41 never asked the model) and for every word that already
  // carries one (the route strips it, `app/api/word/text/route.ts`). Either
  // way «Definición generada» would head nothing: the heading and the
  // hidden a11y label below it swap to the example alone, no board drawn
  // this case (docs/voyager/DESIGN.md, `PalabraSinDefinicionOscuroMovil` is
  // the no-network/no-result/capped state, not this one).
  const hasDefinition = text.definition !== null;
  // RL-45: only a lemma the dictionary answered thin ever carries these
  // (`isThinAnswer`, `apps/voyager/lib/word/thin.ts`); every other lemma's
  // `translations` is `null` and this block draws nothing, same as today.
  const hasNetworkTranslations = text.translations !== null && text.translations.length > 0;

  return (
    <Flex direction="column" data-generated-block="">
      <Separator size="4" />
      <Box pt="2" pb="1">
        <Flex direction="column" gap="2">
          <Flex align="center" gap="2">
            <Text variant="definitionLabel" muted>
              {hasDefinition ? t("definitionGenerated") : t("example")}
            </Text>
            <Text variant="generatedMark" muted="quietest">
              {t("generatedMark")}
            </Text>
          </Flex>
          <Flex direction="column" gap="2">
            {hasDefinition && (
              <Text variant="generatedProse" serif muted>
                {text.definition}
              </Text>
            )}
            <Flex direction="column" gap="1">
              {/* `word.example` and `word.exampleTranslation` label the pair
                  for a screen reader without drawing a fourth caption line —
                  skipped when the heading above already says "Ejemplo". */}
              {hasDefinition && <VisuallyHidden>{t("example")}</VisuallyHidden>}
              <Text variant="generatedProse" serif>
                {text.example.en}
              </Text>
              <VisuallyHidden>{t("exampleTranslation")}</VisuallyHidden>
              <Text variant="exampleTranslation" serif muted>
                {text.example.es}
              </Text>
            </Flex>
          </Flex>
          {hasNetworkTranslations && (
            // Added under the dictionary's own translations, inside the same
            // sense group (docs/voyager/DESIGN.md "A dictionary answer that
            // is thin"), never inside `SenseGroup` itself — this block only
            // ever sits below what `sense-list.tsx` already drew.
            <Flex direction="column" gap="2" data-network-translations="">
              <Flex align="center" gap="2">
                <Text variant="definitionLabel" muted>
                  {t("networkTranslations")}
                </Text>
                <Text variant="generatedMark" muted="quietest">
                  {t("networkMark")}
                </Text>
              </Flex>
              <Flex direction="column" gap="1">
                {text.translations?.map((translation) => (
                  <Text variant="translation" key={translation}>
                    {translation}
                  </Text>
                ))}
              </Flex>
            </Flex>
          )}
        </Flex>
      </Box>
      <Separator size="4" />
    </Flex>
  );
}
