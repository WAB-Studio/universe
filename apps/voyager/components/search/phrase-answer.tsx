"use client";

import { useTranslations } from "next-intl";

import type { TranslationResult } from "@/lib/translate/types";
import { Button, Flex, MetaLabel, Progress, Spinner, Text } from "@/components/ui";
import { PhraseNotes } from "./phrase-notes";

// What stage a sentence lookup is at. The composing module owns the debounce,
// the token floor and the request itself; this only draws the stage it lands
// in (RL-09). `failed` is never drawn here (RL-37): the composing module
// intercepts it and draws the per-word breakdown instead.
export type PhraseState =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "translating" }
  | { kind: "done"; result: TranslationResult }
  | { kind: "failed" };

// Whether the device's translator is worth mentioning, and how far its
// download has gotten when it is (RL-10, RL-11).
export type DeviceOffer =
  | { kind: "hidden" }
  | { kind: "offered" }
  | { kind: "downloading"; fraction: number | null };

export function PhraseAnswer({
  source,
  state,
  offer,
  onEnableDevice,
}: {
  source: string;
  state: PhraseState;
  offer: DeviceOffer;
  onEnableDevice: () => void;
}) {
  const t = useTranslations("phrase");

  // The typing has not settled and nothing was asked for: silence, not a
  // spinner, so the box never flickers while a person is mid-sentence.
  // `failed` draws nothing here either — the composing module never mounts
  // this component while its own state reads `failed` (RL-37).
  if (state.kind === "waiting" || state.kind === "failed") {
    return null;
  }

  return (
    <Flex direction="column" gap="4">
      {state.kind === "translating" && (
        <Flex align="center" gap="2">
          <Spinner />
          <Text size="2" color="gray">
            {t("translating")}
          </Text>
        </Flex>
      )}

      {state.kind === "done" && (
        <Flex direction="column" gap="1">
          <Text variant="translation">{state.result.text}</Text>
          <Text size="2" color="gray">
            {source}
          </Text>
          <MetaLabel>
            {state.result.origin === "device" ? t("originDevice") : t("originNetwork")}
          </MetaLabel>
        </Flex>
      )}

      {/* RL-46: only mounted once a translation already answered, and only
          this leaf ever asks for its own notes — this file gains no state
          and no request of its own on its account. */}
      {state.kind === "done" && <PhraseNotes source={source} translation={state.result.text} />}

      {offer.kind === "offered" && (
        <Flex direction="column" gap="1" align="start">
          <Button size="2" tap onClick={onEnableDevice}>
            {t("enableDevice")}
          </Button>
          <Text size="1" color="gray">
            {t("enableDeviceHint")}
          </Text>
        </Flex>
      )}

      {offer.kind === "downloading" && (
        <Flex direction="column" gap="1">
          <Text size="2" color="gray">
            {t("downloadingModel")}
          </Text>
          {offer.fraction === null ? (
            <Progress />
          ) : (
            <>
              <Progress value={Math.round(offer.fraction * 100)} />
              <Text size="1" color="gray">
                {t("downloadProgress", { percent: Math.round(offer.fraction * 100) })}
              </Text>
            </>
          )}
        </Flex>
      )}
    </Flex>
  );
}
