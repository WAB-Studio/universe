import { useTranslations } from "next-intl";

import { Box, Flex, Separator, Text, VisuallyHidden } from "@/components/ui";
import type { UnlistedAnswer } from "@/lib/word/unlisted-protocol";

// The four shapes a word's network answer can be in. State in, DOM out:
// this file makes no request of its own (RL-44, RL-47's visible half).
export type NetworkAnswerState =
  | { kind: "pending" }
  | { kind: "resolved"; answer: UnlistedAnswer }
  | { kind: "failed" }
  | { kind: "absent" };

// The word this answer is for. Nothing in `state` carries it — `resolved`
// answers a word without naming it back — so the caller passes it, the same
// door `WordPhoto` opens for its own alt text. Kept off every visible line
// (no key here interpolates it) and read only as a scoping key for the
// block, the same role `sense-list.tsx` gives `surface` in a React key.
export function NetworkAnswer({ state, surface }: { state: NetworkAnswerState; surface: string }) {
  const t = useTranslations("word");

  // `absent`: the dictionary answered on its own, or nothing has been asked
  // of the network yet. Draws nothing, the same rule `GeneratedText` follows.
  if (state.kind === "absent") return null;

  if (state.kind === "pending") {
    // No spinner and no mark: there is nothing from the network yet to mark
    // as from the network (same rule `GeneratedText`'s own pending follows).
    return (
      <Flex direction="column" data-network-answer={surface}>
        <Separator size="4" />
        <Box pt="2" pb="1">
          <Text variant="pendingHint" serif muted>
            {t("networkPending")}
          </Text>
        </Box>
        <Separator size="4" />
      </Flex>
    );
  }

  if (state.kind === "failed") {
    // docs/voyager/DESIGN.md "Failure": a hairline sets the break off, the
    // line itself in full-weight ink — never muted, never the accent — says
    // it. No colour is added and no retry is offered: an answer that could
    // not be produced is a fact this screen states, not a control it hands
    // back to the reader.
    return (
      <Flex direction="column" gap="3" align="start" data-network-answer={surface}>
        <Separator size="4" />
        <Text size="2" weight="bold">
          {t("networkFailed")}
        </Text>
      </Flex>
    );
  }

  const { answer } = state;
  // A translation is what makes this an answer at all: with none, the route
  // itself would have answered `failed` (module 10's contract). `definition`
  // alone is `string | null` and reaching null here is not a failure — an
  // answer whose translation is its cognate is complete without one
  // (docs/voyager/DESIGN.md "A word the dictionary has no entry for").
  const hasDefinition = answer.definition !== null;

  return (
    <Flex direction="column" data-network-answer={surface}>
      <Separator size="4" />
      <Box pt="2" pb="1">
        <Flex direction="column" gap="2">
          <Flex align="center" gap="2">
            <Text variant="definitionLabel" muted>
              {t("networkAnswerTitle")}
            </Text>
            <Text variant="generatedMark" muted="quietest">
              {t("networkMark")}
            </Text>
          </Flex>
          <Flex direction="column" gap="1">
            <Text variant="definitionLabel" muted>
              {t("networkTranslations")}
            </Text>
            {answer.translations.map((translation) => (
              <Text variant="translation" key={translation}>
                {translation}
              </Text>
            ))}
          </Flex>
          {hasDefinition && (
            <Flex direction="column" gap="1" data-network-definition-block="">
              <Text variant="definitionLabel" muted>
                {t("definitionEnglish")}
              </Text>
              <Text variant="generatedProse" serif muted>
                {answer.definition}
              </Text>
            </Flex>
          )}
          <Flex direction="column" gap="1">
            <Text variant="definitionLabel" muted>
              {t("example")}
            </Text>
            <Text variant="generatedProse" serif>
              {answer.example.en}
            </Text>
            <VisuallyHidden>{t("exampleTranslation")}</VisuallyHidden>
            <Text variant="exampleTranslation" serif muted>
              {answer.example.es}
            </Text>
          </Flex>
        </Flex>
      </Box>
      <Separator size="4" />
    </Flex>
  );
}
