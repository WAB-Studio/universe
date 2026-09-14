"use client";

import { useSyncExternalStore } from "react";
import NextLink from "next/link";
import { useTranslations } from "next-intl";

import type { Sense } from "@/lib/dictionary/index-build";
import type { WordAnswer } from "@/lib/dictionary/lookup";
import { speak, speechSupported } from "@/lib/speech/speak";
import {
  Box,
  Flex,
  Grid,
  Headword,
  IconButton,
  Link,
  PosLabel,
  Separator,
  Text,
  TapTarget,
} from "@/components/ui";
import { GeneratedText, type GeneratedTextState } from "./generated-text";
import { NetworkAnswer, type NetworkAnswerState } from "./network-answer";
import { WordPhoto, type PhotoState } from "./word-photo";

// `search-screen.tsx`'s own query name: every door this file opens onto a
// correction is `/?q=<word>`, the same param `no-entry-answer.tsx` reads —
// no shared import between the two, so the literal is repeated, not the code.
const CORRECTION_QUERY_PARAM = "q";

function correctionHref(word: string): string {
  return `/?${CORRECTION_QUERY_PARAM}=${encodeURIComponent(word)}`;
}

// docs/voyager/DESIGN.md "Viewport": stroke-width 1.75, round caps and
// joins, fill none — the same glyph shape `bottom-nav.tsx` draws, sized down
// for an inline word.
function ChevronGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// A block's own headword, made into `wordHref`'s door back to the full
// entry: `Headword` sets no colour of its own, so `Link`'s accent cascades
// into it — the same route `no-entry-answer.tsx` takes for the miss line.
// Plain when `wordHref` is absent, which is every call outside the
// breakdown. `headwordSize` carries `PalabraConFlexion`'s own smaller
// offer heading through to `Headword`; every other caller leaves it at the
// default 34px.
function BlockHeading({
  word,
  wordHref,
  headwordSize,
}: {
  word: string;
  wordHref?: string;
  headwordSize?: "default" | "offer";
}) {
  if (!wordHref) return <Headword size={headwordSize}>{word}</Headword>;
  return (
    <Link asChild underline="always">
      <NextLink href={wordHref}>
        <TapTarget align="center" gap="1">
          <Headword size={headwordSize}>{word}</Headword>
          <ChevronGlyph />
        </TapTarget>
      </NextLink>
    </Link>
  );
}

// The glyph docs/voyager/DESIGN.md "Settled" fixes exactly: a play triangle
// and two sound arcs, 1.75px strokes, round caps and joins. Drawn here
// rather than pulled from lucide because the path itself is what the board
// settles, not a stand-in for "speaker".
function SpeakerGlyph() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M17 8.5a5 5 0 010 7" />
      <path d="M19.5 6a8.5 8.5 0 010 12" />
    </svg>
  );
}

// `speechSupported()` never changes within one page life, so there is
// nothing to subscribe to — only a snapshot to read, which is what tells
// `useSyncExternalStore` to skip the effect-driven setState this needs to
// stay SSR-safe: false on the server (no `window`), the real answer once
// the client itself renders.
function subscribeNever(): () => void {
  return () => {};
}

function getServerSnapshot(): boolean {
  return false;
}

// RL-26: a headword can be heard. Asked of the browser fresh on every open —
// never inferred from its name or version — so a browser with no
// `speechSynthesis` shows no control at all, rather than one that does
// nothing when pressed.
function SpeakButton({ headword, t }: { headword: string; t: ReturnType<typeof useTranslations> }) {
  const supported = useSyncExternalStore(subscribeNever, speechSupported, getServerSnapshot);

  if (!supported) return null;

  return (
    <IconButton
      type="button"
      size="2"
      variant="ghost"
      color="gray"
      tap={44}
      aria-label={t("listen", { headword })}
      onClick={() => speak(headword)}
    >
      <SpeakerGlyph />
    </IconButton>
  );
}

// One sense's own body: every translation on its own line, its English
// definition drawn open beneath its own label when the entry carries one
// (docs/voyager/DESIGN.md "The English definition draws open, always"), and
// its own IPA only when it differs from the one already drawn on
// its segment's label row — repeating an identical IPA on every sense would
// say nothing a reader does not already have. `compact` drops the IPA and
// the definition (docs/voyager/DESIGN.md "A word block on `SinEntradaFrase`
// carries its translations alone"): only `NoEntryAnswer`'s per-word
// breakdown ever sets it.
function SenseDetail({
  sense,
  segmentIpa,
  compact,
  t,
}: {
  sense: Sense;
  segmentIpa: string | null;
  compact: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const ownIpa = !compact && sense.ipa !== null && sense.ipa !== segmentIpa ? sense.ipa : null;

  return (
    <Flex direction="column" gap="2">
      <Flex direction="column" gap="1">
        {ownIpa !== null && (
          <Text size="2" color="gray" truncate>
            {ownIpa}
          </Text>
        )}
        <Text size="1" color="gray">
          {t("translations")}
        </Text>
        {sense.translations.map((translation) => (
          <Text variant="translation" key={translation}>
            {translation}
          </Text>
        ))}
      </Flex>
      {!compact && sense.definition !== null && (
        <Flex direction="column" data-definition-block="">
          <Separator size="4" />
          <Box pt="2" pb="1">
            <Flex direction="column" gap="1">
              <Text variant="definitionLabel" muted>
                {t("definitionEnglish")}
              </Text>
              <Text size="2" serif muted>
                {sense.definition}
              </Text>
            </Flex>
          </Box>
          <Separator size="4" />
        </Flex>
      )}
    </Flex>
  );
}

// A contiguous run of same-part-of-speech senses: one `PosLabel`, one IPA
// taken from the run's first sense, and every sense's own body ruled apart
// with a hairline. Never a card, never a border box (docs/voyager/DESIGN.md).
function PosSegment({
  segment,
  compact,
  t,
}: {
  segment: SenseSegment;
  compact: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const segmentIpa = segment.senses[0].ipa;

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" gap="2">
        <PosLabel>{t(`pos.${segment.pos}`)}</PosLabel>
        {!compact && segmentIpa !== null && (
          // IPA runs past 120 characters with no space to break on, and it is
          // metadata beside the headword, not the headword itself — one
          // clamped line reads better than four wrapped ones. `PosLabel` has
          // no intrinsic width limit of its own, so the row's flex-shrink
          // alone would starve it too; the clamp has to come from `Grid`,
          // whose `minmax(0, 1fr)` governs the item regardless
          // (docs/voyager/DESIGN.md "What the data forces").
          <Grid flexGrow="1" minWidth="0">
            <Text size="2" color="gray" align="right" truncate>
              {segmentIpa}
            </Text>
          </Grid>
        )}
      </Flex>
      {segment.senses.map((sense, index) => (
        <Flex direction="column" gap="3" key={index}>
          {index > 0 && <Separator size="4" />}
          <SenseDetail sense={sense} segmentIpa={segmentIpa} compact={compact} t={t} />
        </Flex>
      ))}
    </Flex>
  );
}

type SenseSegment = { pos: Sense["pos"]; senses: Sense[] };

// `groupFor` (lib/dictionary/index-build.ts) already sorts senses by
// POS_RANK, so every sense of one part of speech arrives contiguous: this
// only draws its label once instead of once per sense (RL-04).
function segmentByPos(senses: readonly Sense[]): SenseSegment[] {
  const segments: SenseSegment[] = [];
  for (const sense of senses) {
    const open = segments.at(-1);
    if (open !== undefined && open.pos === sense.pos) open.senses.push(sense);
    else segments.push({ pos: sense.pos, senses: [sense] });
  }
  return segments;
}

// A group of part-of-speech segments ruled apart with a hairline, one per
// headword or inflected form.
function SenseGroup({
  senses,
  compact,
  t,
}: {
  senses: readonly Sense[];
  compact: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const segments = segmentByPos(senses);

  return (
    <Flex direction="column" gap="3">
      {segments.map((segment, index) => (
        <Flex direction="column" gap="3" key={index}>
          {index > 0 && <Separator size="4" />}
          <PosSegment segment={segment} compact={compact} t={t} />
        </Flex>
      ))}
    </Flex>
  );
}

// RL-28: every headword `lookupWord` found one edit from the miss, each its
// own tap back into `/?q=<word>` — the same door `BlockHeading` opens, drawn
// smaller here because there is no entry underneath it yet to lead into. No
// cap, on the data or on the screen: `hits.sort()` in `edit-distance.ts` is
// alphabetical, not ranked by anything the reader meant, so cutting it after
// five would drop the intended word by accident of spelling, not keep it —
// measured 2026-09-11, more than five candidates happens on 0.9% of 4,000
// real one-edit typos. `wrap="wrap"` below carries nine short words in a
// few rows at 360px with nothing pushed off screen (checked against `boz`).
// Silent when `words` is empty — `zzqqxv` is the only case left that reaches
// no headword at all; a real word the dictionary lacks (`fettle`) draws its
// wrong-looking candidates here until RL-29 gives that reader a better door.
function CorrectionOffer({ words, t }: { words: readonly string[]; t: ReturnType<typeof useTranslations> }) {
  return (
    <Flex direction="column" gap="2">
      <Text size="2" color="gray">
        {t("correctionTitle")}
      </Text>
      <Flex gap="4" wrap="wrap">
        {words.map((word) => (
          <Link asChild underline="always" key={word}>
            <NextLink href={correctionHref(word)}>
              <TapTarget align="center" gap="1">
                <Text size="3" serif>
                  {word}
                </Text>
                <ChevronGlyph />
              </TapTarget>
            </NextLink>
          </Link>
        ))}
      </Flex>
    </Flex>
  );
}

// `full` is a direct lookup's own answer — IPA, definition, voice, the lot.
// `compact` is a word block inside the no-entry breakdown
// (`no-entry-answer.tsx`): headword, category and translations alone
// (docs/voyager/DESIGN.md "A word block on `SinEntradaFrase` carries its
// translations alone"), and no voice control — that belongs to the word
// screen's own four boards, never to the breakdown (docs/voyager/DESIGN.md
// "RL-26").
export type SenseListVariant = "full" | "compact";

// A headword's full answer: its own senses first, then every inflected form
// that reached one, each carrying its own senses in turn (RL-04, RL-40).
export function SenseList({
  answer,
  variant = "full",
  wordHref,
  showExactHeadword = true,
  photo,
  generated,
  networkAnswer,
}: {
  answer: WordAnswer;
  variant?: SenseListVariant;
  // The breakdown's own door back to `/?q=<word>` (docs/voyager/DESIGN.md
  // "Every block of the breakdown is a way back in"). Set by
  // `no-entry-answer.tsx` alone; a direct lookup passes nothing, so its
  // headword stays plain.
  wordHref?: string;
  // False on `/registro/[palabra]` alone: that screen already draws the
  // word as its own page heading, so the exact match's own copy of it, or
  // the form-first headword the sin-`exact` branch now leads with, would
  // repeat as a second heading sharing the page heading's name. The offered
  // lemma underneath still gets its own heading either way — that word
  // never names the page.
  showExactHeadword?: boolean;
  // Set by `search-screen.tsx` alone, from `useDecoration` — the state a
  // network call resolved for the exact headword, never fetched here.
  // Absent on `/registro/[palabra]`, which opens no connection at all.
  photo?: PhotoState;
  generated?: GeneratedTextState;
  // Set by `search-screen.tsx` alone (module 12), from the hook module 10
  // wires to `/api/word/unlisted`. Absent on `/registro/[palabra]` and on
  // every `compact` call, so neither opens a connection of its own
  // (RL-47's own screen, never the breakdown's eight words at once).
  networkAnswer?: NetworkAnswerState;
}) {
  const t = useTranslations("word");
  const tSearch = useTranslations("search");
  const compact = variant === "compact";

  const hasAnswer = answer.exact !== null || answer.viaInflection.length > 0;
  if (!hasAnswer) {
    return (
      <Flex direction="column" gap="3">
        <Flex direction="column" gap="1">
          <Text size="3">{tSearch("notFound")}</Text>
          {/* RL-28 replaces the hint below with a correction the moment one
              exists — "revisa la ortografía" tells the reader nothing a tap
              wouldn't have already fixed for them. */}
          {answer.correction.length === 0 && (
            <Text size="2" color="gray">
              {tSearch("notFoundHint")}
            </Text>
          )}
        </Flex>
        {answer.correction.length > 0 && <CorrectionOffer words={answer.correction} t={tSearch} />}
        {!compact && networkAnswer && <NetworkAnswer state={networkAnswer} surface={answer.query} />}
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="4">
      {answer.exact !== null && (
        <Flex direction="column" gap="3">
          <Flex align="center" gap="1">
            {showExactHeadword && <BlockHeading word={answer.exact.headword} wordHref={wordHref} />}
            {!compact && <SpeakButton headword={answer.exact.headword} t={t} />}
            {/* `compact` never reaches this row at all (`SenseListVariant`
                above): the breakdown of a failed phrase asks the network for
                nothing on eight words' behalf (RL-35's decoration clause). */}
            {!compact && photo && <WordPhoto headword={answer.exact.headword} state={photo} />}
          </Flex>
          <SenseGroup senses={answer.exact.senses} compact={compact} t={t} />
          {!compact && generated && <GeneratedText state={generated} />}
        </Flex>
      )}

      {answer.viaInflection.length > 0 &&
        (answer.exact !== null ? (
          // docs/voyager/DESIGN.md "PalabraConFlexion": the entry above
          // answers; this offers, never replaces. The 2px rule marks where
          // the entry ends and the offer begins, and each hit sits in its
          // own indented rail — a smaller heading and a muted label are the
          // only things that rank it under the entry, no colour a plain
          // reading wouldn't already have.
          <Flex direction="column" gap="4">
            <Separator size="4" weight="heavy" />
            {answer.viaInflection.map((hit, index) => (
              <Flex direction="column" gap="3" key={`${hit.surface}-${hit.lemma}`}>
                {index > 0 && <Separator size="4" />}
                <Box rail>
                  <Flex direction="column" gap="3">
                    <Flex direction="column" gap="1">
                      <PosLabel muted>
                        {t("viaInflectionWithEntry", { surface: hit.surface, lemma: hit.lemma })}
                      </PosLabel>
                      <Flex align="center" gap="1">
                        <BlockHeading word={hit.lemma} wordHref={wordHref} headwordSize="offer" />
                        {!compact && <SpeakButton headword={hit.lemma} t={t} />}
                      </Flex>
                    </Flex>
                    <SenseGroup senses={hit.group.senses} compact={compact} t={t} />
                  </Flex>
                </Box>
              </Flex>
            ))}
          </Flex>
        ) : (
          // RL-47: the form is only a form — the top of the screen is a
          // different word wearing the same spelling, so the form the
          // reader typed leads and the lemma it comes from sits under the
          // 2px rule, in the same rail the `exact` branch above offers it
          // from (docs/voyager/DESIGN.md "The form the reader typed leads
          // the answer"). Every hit shares one `surface` (`lookupWord`
          // fixes it once per query), so the headword and its network
          // answer draw once, ahead of however many lemma candidates follow.
          <Flex direction="column" gap="4">
            <Flex direction="column" gap="3">
              <Flex align="center" gap="1">
                {showExactHeadword && (
                  <BlockHeading word={answer.viaInflection[0].surface} wordHref={wordHref} />
                )}
                {!compact && <SpeakButton headword={answer.viaInflection[0].surface} t={t} />}
              </Flex>
              {!compact && networkAnswer && (
                <NetworkAnswer state={networkAnswer} surface={answer.viaInflection[0].surface} />
              )}
            </Flex>
            <Separator size="4" weight="heavy" />
            {answer.viaInflection.map((hit, index) => (
              <Flex direction="column" gap="3" key={`${hit.surface}-${hit.lemma}`}>
                {index > 0 && <Separator size="4" />}
                <Box rail>
                  <Flex direction="column" gap="3">
                    <Flex direction="column" gap="1">
                      <PosLabel muted>{t("formOf", { surface: hit.surface, lemma: hit.lemma })}</PosLabel>
                      <Flex align="center" gap="1">
                        <BlockHeading word={hit.lemma} wordHref={wordHref} headwordSize="offer" />
                        {!compact && <SpeakButton headword={hit.lemma} t={t} />}
                      </Flex>
                    </Flex>
                    <SenseGroup senses={hit.group.senses} compact={compact} t={t} />
                  </Flex>
                </Box>
              </Flex>
            ))}
          </Flex>
        ))}
    </Flex>
  );
}
