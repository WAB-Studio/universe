"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { classify, PHRASE_MAX_TOKENS, PHRASE_MIN_TOKENS, type QueryKind } from "@/lib/query/classify";
import { PHRASE_DEBOUNCE_MS } from "@/lib/query/settle";
import { normaliseHeadword } from "@/lib/dictionary/format";
import type { Sense, SenseGroup } from "@/lib/dictionary/index-build";
import { useDictionary } from "@/lib/dictionary/use-dictionary";
import type { WordAnswer } from "@/lib/dictionary/lookup";
import { useDecoration } from "@/lib/word/use-decoration";
import { useNetworkAnswer } from "@/lib/word/use-network-answer";
import { deviceTranslatorState, type TranslatorState } from "@/lib/translate/availability";
import { enableDeviceTranslator, translateOnDevice } from "@/lib/translate/on-device";
import { translateOverNetwork } from "@/lib/translate/network";
import type { TranslationResult } from "@/lib/translate/types";
import { flushPendingLookup, recordLookup } from "@/lib/log/record";
import type { LookupOutcome, LookupRecord } from "@/lib/log/types";
import { Flex, Text } from "@/components/ui";
import { InstallStatus } from "./install-status";
import { NoEntryAnswer, type NoEntryPart, type NoEntryReason, type NoEntryState } from "./no-entry-answer";
import { PhraseAnswer, type DeviceOffer, type PhraseState } from "./phrase-answer";
import { SearchBox } from "./search-box";
import { SenseList } from "./sense-list";
import { Suggestions } from "./suggestions";

// The query string's own name: `/?q=book`.
const QUERY_PARAM = "q";

// RNL-05, rule 3: how many translated sentences stay free to revisit.
const PHRASE_CACHE_LIMIT = 20;

type LogPayload = Omit<LookupRecord, "id" | "schema">;

// Module scope on purpose: it survives client-side navigation inside the tab
// but not a reload. Tapping "Registro" unmounts this screen, and coming back
// lands on `/?q=<word>` — the URL keeps the query — so the mount effect
// answers it again. Answering again is right; recording it again is not.
// A reader who walks to the log and back five times looked the word up once.
let lastLoggedText: string | null = null;

// Cut, never truncated silently past the point RL-34's list can hold — the
// module 27 wire schema and the row this fills both agree on the same 120.
const TRANSLATION_MAX_CHARS = 120;
const TRANSLATION_MAX_SENSES = 3;

function cutTranslation(text: string): string {
  if (text.length <= TRANSLATION_MAX_CHARS) return text;
  // The cut can land mid-separator, leaving ", " or "," dangling at the
  // end. Trim it — the 120 cap stays a ceiling, not a quota, so a shorter
  // result here is fine. A cut that lands mid-word is left alone.
  return text.slice(0, TRANSLATION_MAX_CHARS).replace(/[,\s]+$/u, "");
}

// Up to the group's first three senses, every translation each one carries,
// joined the way `SenseCard` lists them within one sense. The 120-char cut
// is the storage limit; this cap is only a maximum on top of it, so a word
// with fewer, longer senses can still lose its third one to the cut.
function formatSenseTranslations(senses: readonly Sense[]): string {
  const joined = senses
    .slice(0, TRANSLATION_MAX_SENSES)
    .flatMap((sense) => sense.translations)
    .join(", ");
  return cutTranslation(joined);
}

// RL-41: "a word that already has a definition never asks for one" — true
// only when none of the exact match's own senses carry one.
function needsDefinition(group: SenseGroup): boolean {
  return group.senses.every((sense) => sense.definition === null);
}

function wordLogPayload(text: string, answer: WordAnswer, dictionaryReady: boolean): LogPayload {
  const hit = answer.viaInflection[0] ?? null;
  const outcome: LookupOutcome = answer.exact ? "exact" : hit ? "inflected" : "miss";
  const group = answer.exact ?? hit?.group ?? null;
  return {
    at: Date.now(),
    text,
    normalised: normaliseHeadword(text),
    kind: "word",
    outcome,
    headword: answer.exact ? answer.exact.headword : (hit?.group.headword ?? null),
    rule: hit ? hit.rule : null,
    senses: group?.senses.length ?? 0,
    translation: group ? formatSenseTranslations(group.senses) : null,
    dictionaryReady,
    origin: null,
  };
}

function phraseLogPayload(
  text: string,
  dictionaryReady: boolean,
  outcome: LookupOutcome,
  origin: TranslationResult["origin"] | null,
  translation: string | null,
): LogPayload {
  return {
    at: Date.now(),
    text,
    normalised: normaliseHeadword(text),
    kind: "phrase",
    outcome,
    headword: null,
    rule: null,
    senses: 0,
    translation: translation === null ? null : cutTranslation(translation),
    dictionaryReady,
    origin,
  };
}

function trimPhraseCache(cache: Map<string, TranslationResult>): void {
  while (cache.size > PHRASE_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

// The address bar outranks the server prop whenever both exist: a trip to
// `/fuente` and back can hand this component a page shell Next served from
// its own route cache, still carrying the query the reader typed before
// that trip left, while `window.location` already reads the real one.
// `searchParams` only ever wins during the window-less server render itself.
function resolveInitialQuery(prop: string | undefined): string {
  if (typeof window === "undefined") return prop ?? "";
  return new URLSearchParams(window.location.search).get(QUERY_PARAM) ?? (prop ?? "");
}

export function SearchScreen({ initialQuery }: { initialQuery?: string }) {
  const tSearch = useTranslations("search");
  const { status, lookup, suggest, has, retry } = useDictionary();

  // Read once, at the first render this instance ever gets — including a
  // remount Next hands back a stale shell for.
  const resolvedQuery = resolveInitialQuery(initialQuery);

  const [text, setText] = useState(resolvedQuery);
  const [kind, setKind] = useState<QueryKind>({ kind: "empty" });
  const [wordAnswer, setWordAnswer] = useState<WordAnswer | null>(null);
  // RL-18: stays on screen until the text itself changes, never on a timer
  // — a paused prefix keeps its list. Decided by the user 2026-09-09.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [phraseState, setPhraseState] = useState<PhraseState>({ kind: "idle" });
  // RL-31: a two-token miss or a >60-token string never reaches
  // `translatePhrase` — this is the state that draws in its place. RL-37
  // reuses it for a 3-to-60-token phrase whose translation failed instead.
  const [noEntryState, setNoEntryState] = useState<NoEntryState | null>(null);
  const [deviceOffer, setDeviceOffer] = useState<DeviceOffer>({ kind: "hidden" });
  const [logPayload, setLogPayload] = useState<LogPayload | null>(null);

  // The text a resolved promise checks itself against: an answer for
  // anything else was superseded before it arrived, and is dropped.
  const latestTextRef = useRef("");
  const phraseDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phraseAbortRef = useRef<AbortController | null>(null);
  const phraseCacheRef = useRef(new Map<string, TranslationResult>());
  // Read once per open (RL-08); routing for every phrase after that reads
  // this instead of asking the browser again.
  const initialDeviceStateRef = useRef<TranslatorState | null>(null);
  const deviceReadyRef = useRef(false);

  // The query this lookup's own history entry already carries — read once
  // from the URL at mount, then updated only where the URL itself is
  // written, so a settle never repeats an entry that already matches it.
  const committedTextRef = useRef(resolvedQuery);
  // True from an empty box up to the next settled text: that settle opens a
  // fresh history entry (`pushState`). Every settle after it, until the box
  // empties again, refines that same entry (`replaceState`) instead of
  // piling one up per pause mid-word — RNL-05's rhythm, one lookup at a time.
  const boundaryRef = useRef(resolvedQuery === "");
  const urlSettleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialQueryRanRef = useRef(false);
  // True when this mount is restoring a query this tab already recorded.
  const restoringRef = useRef(false);

  // The call site the log's fields are true to: an effect fires after React
  // has already committed the answer, never inside the path that produced it.
  useEffect(() => {
    if (!logPayload) return;
    // Conditioned on both the flag and the text, so a restore can never
    // swallow the next genuine lookup, whatever order the two arrive in.
    if (restoringRef.current && logPayload.text === lastLoggedText) {
      restoringRef.current = false;
      return;
    }
    recordLookup(logPayload);
    lastLoggedText = logPayload.text;
  }, [logPayload]);

  useEffect(() => {
    return () => {
      if (urlSettleRef.current) clearTimeout(urlSettleRef.current);
      // A tap on "Registro" or "Cuenta" is client-side navigation: the
      // document never unloads, so neither `pagehide` nor
      // `visibilitychange` fires and a pending row would otherwise sit
      // unwritten until `record.ts`'s 5 s ceiling. Unmounting this screen
      // is the one signal every in-app trip away from `/` shares.
      flushPendingLookup();
    };
  }, []);

  // Opening `/?q=book` cold answers `book` with no typing: the lookup this
  // effect fires runs once, client-side, against whatever `status` reads at
  // that first tick — the worker still queues it if the dictionary is not
  // built yet (mirrors a keystroke landing mid-install).
  useEffect(() => {
    if (initialQueryRanRef.current || !resolvedQuery) return;
    initialQueryRanRef.current = true;
    restoringRef.current = resolvedQuery === lastLoggedText;
    latestTextRef.current = resolvedQuery;
    void runQuery(resolvedQuery, status.state === "ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A block of the breakdown links to `/?q=<word>` while this very screen
  // stays mounted (docs/voyager/DESIGN.md "Every block of the breakdown is
  // a way back in"): Next re-renders `app/page.tsx` with the new
  // `searchParams`, but nothing unmounts this component to make the mount
  // effect above run again. `committedTextRef` is what tells the two apart
  // from a keystroke's own write to the same ref: a prop the mount effect
  // already consumed is skipped here.
  useEffect(() => {
    if (!initialQuery || initialQuery === committedTextRef.current) return;
    committedTextRef.current = initialQuery;
    boundaryRef.current = false;
    applyText(initialQuery, { schedule: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  // The browser's own back and forward across this screen's own history
  // entries: nothing else updates the box or re-asks the dictionary when
  // the URL changes out from under a mounted `SearchScreen` (RNL-05's rule
  // 4 extended to a navigation, not only to a keystroke).
  useEffect(() => {
    function handlePopState(): void {
      const nextText = new URLSearchParams(window.location.search).get(QUERY_PARAM) ?? "";
      committedTextRef.current = nextText;
      boundaryRef.current = nextText === "";
      applyText(nextText, { schedule: false });
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.state]);

  // Writes `/?q=<text>` once a lookup settles — never on the keystroke that
  // produced it. A text already sitting in the URL, or an empty box, writes
  // nothing: RL-14 owes the network no request either way, and the price the
  // reader was told about is one entry per lookup, not one per pause.
  function commitUrl(committedText: string): void {
    if (committedText === "" || committedText === committedTextRef.current) return;
    const params = new URLSearchParams(window.location.search);
    params.set(QUERY_PARAM, committedText);
    const url = `?${params.toString()}`;
    if (boundaryRef.current) {
      window.history.pushState(null, "", url);
      boundaryRef.current = false;
    } else {
      window.history.replaceState(null, "", url);
    }
    committedTextRef.current = committedText;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await deviceTranslatorState();
      if (cancelled) return;
      initialDeviceStateRef.current = state;
      // The model is already on the device: creating it costs no download,
      // so no gesture is owed (RL-11's one exception).
      if (state === "available") {
        try {
          await enableDeviceTranslator();
          if (!cancelled) deviceReadyRef.current = true;
        } catch {
          // Falls back to the network path like any other unready state.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function translatePhrase(phraseText: string, dictionaryReady: boolean): Promise<void> {
    const controller = new AbortController();
    phraseAbortRef.current = controller;
    setPhraseState({ kind: "translating" });

    try {
      let result: TranslationResult;
      if (deviceReadyRef.current) {
        try {
          result = await translateOnDevice(phraseText, { signal: controller.signal });
        } catch {
          // A superseded request stops here too: nothing left to fall back to.
          if (controller.signal.aborted) return;
          result = await translateOverNetwork(phraseText, { signal: controller.signal });
        }
      } else {
        result = await translateOverNetwork(phraseText, { signal: controller.signal });
        const initial = initialDeviceStateRef.current;
        if (initial === "downloadable" || initial === "downloading") {
          setDeviceOffer((current) => (current.kind === "downloading" ? current : { kind: "offered" }));
        }
      }

      if (controller.signal.aborted) return;
      phraseCacheRef.current.set(normaliseHeadword(phraseText), result);
      trimPhraseCache(phraseCacheRef.current);
      setPhraseState({ kind: "done", result });
      setLogPayload(phraseLogPayload(phraseText, dictionaryReady, "translated", result.origin, result.text));
    } catch {
      if (controller.signal.aborted) return;
      // RL-37: a phrase in range that cannot be translated falls to the same
      // per-word breakdown RL-31 draws for one that was never tried — the
      // trigger is this `failed` state, never a `done` with empty text.
      // RL-39 still logs the call: `commit` in record.ts is what drops an
      // "untranslated" outcome, so the chain keeps advancing past it instead
      // of leaving an earlier, answered prefix stranded in `pending`.
      setPhraseState({ kind: "failed" });
      setLogPayload(phraseLogPayload(phraseText, dictionaryReady, "untranslated", null, null));
      resolveWordBreakdown(phraseText, "translationFailed");
    } finally {
      if (phraseAbortRef.current === controller) phraseAbortRef.current = null;
    }
  }

  // Looks every word of `phraseText` up on the device, one `lookup` call
  // each, with no debounce and no network — shared by RL-31's miss and
  // RL-37's translation failure, which differ only in which line names what
  // went wrong (`reason`, read by `NoEntryAnswer`'s title). `onResolved`
  // fires once the breakdown itself is in, so a caller that owes the log a
  // row waits for the same tick the screen does instead of racing it.
  function resolveWordBreakdown(phraseText: string, reason: NoEntryReason, onResolved?: () => void): void {
    setNoEntryState({ kind: "resolving", query: phraseText });
    const words = phraseText.trim().replace(/\s+/g, " ").split(" ");
    void Promise.all(words.map((word) => lookup(word).catch(() => null))).then((answers) => {
      // Same guard `runQuery` already uses at :346 and :368: a superseded
      // reply is dropped, never painted over whatever replaced it.
      if (latestTextRef.current !== phraseText) return;
      const parts: NoEntryPart[] = words.map((word, index) => ({ token: word, answer: answers[index] ?? null }));
      setNoEntryState({ kind: "words", query: phraseText, parts, reason });
      onResolved?.();
    });
  }

  // RL-31: below the floor, every token is looked up on the device, with no
  // debounce — RNL-05 only throttles the network path, and this one never
  // reaches it. Above the ceiling, nothing is asked at all. Both branches
  // still log the call, as a "miss": `commit` in record.ts is what drops it,
  // so an abandoned phrase can't leave an earlier, answered prefix behind
  // (the same reasoning as RL-39's word path).
  function scheduleNoEntry(phraseText: string, tokens: number, dictionaryReady: boolean): void {
    if (tokens > PHRASE_MAX_TOKENS) {
      setNoEntryState({ kind: "tooLong", query: phraseText, tokens });
      setLogPayload(phraseLogPayload(phraseText, dictionaryReady, "miss", null, null));
      return;
    }

    resolveWordBreakdown(phraseText, "noEntry", () => {
      setLogPayload(phraseLogPayload(phraseText, dictionaryReady, "miss", null, null));
    });
  }

  function schedulePhrase(phraseText: string, tokens: number, dictionaryReady: boolean): void {
    if (tokens < PHRASE_MIN_TOKENS || tokens > PHRASE_MAX_TOKENS) {
      scheduleNoEntry(phraseText, tokens, dictionaryReady);
      return;
    }

    // RNL-05, rule 3: a text already translated costs nothing and issues
    // nothing, however far back the box was cleared to reach it.
    const cached = phraseCacheRef.current.get(normaliseHeadword(phraseText));
    if (cached) {
      setPhraseState({ kind: "done", result: cached });
      setLogPayload(phraseLogPayload(phraseText, dictionaryReady, "translated", cached.origin, cached.text));
      return;
    }

    // Offline-first, decided 2026-09-11: the translator is a network call by
    // definition, so with none to make the request would only wait to fail.
    // `failed` is the state the JSX below already reads to hand a phrase to
    // `NoEntryAnswer` instead of `PhraseAnswer` (RL-37) — offline reaches
    // the same breakdown through the same door, just without the wait.
    if (!navigator.onLine) {
      setPhraseState({ kind: "failed" });
      scheduleNoEntry(phraseText, tokens, dictionaryReady);
      return;
    }

    setPhraseState({ kind: "waiting" });
    phraseDebounceRef.current = setTimeout(() => {
      phraseDebounceRef.current = null;
      void translatePhrase(phraseText, dictionaryReady);
    }, PHRASE_DEBOUNCE_MS);
  }

  async function runQuery(queryText: string, dictionaryReady: boolean): Promise<void> {
    const exists = await has(queryText).catch(() => false);
    if (latestTextRef.current !== queryText) return;

    const nextKind = classify(queryText, () => exists);
    setKind(nextKind);

    if (nextKind.kind === "empty") {
      setWordAnswer(null);
      setSuggestions([]);
      setPhraseState({ kind: "idle" });
      // The guard has no other way to learn the box was abandoned mid-word.
      flushPendingLookup();
      return;
    }

    if (nextKind.kind === "word") {
      setPhraseState({ kind: "idle" });
      setWordAnswer(null);
      setSuggestions([]);
      const [answer, items] = await Promise.all([
        lookup(queryText).catch(() => null),
        suggest(queryText, 10).catch(() => [] as string[]),
      ]);
      if (latestTextRef.current !== queryText || !answer) return;
      setWordAnswer(answer);
      setSuggestions(items);
      // RL-39: a miss leaves no row, but the call still happens — `commit`
      // in record.ts is what drops a "miss" outcome, not this call site. A
      // guard here would leave the last *answered* prefix stuck in
      // `pending` forever, to be written once the reader had moved on to
      // something else entirely (measured: "asdkjhqwe" left `asd | exact |
      // TEA` behind).
      setLogPayload(wordLogPayload(queryText, answer, dictionaryReady));
      return;
    }

    setWordAnswer(null);
    setSuggestions([]);
    schedulePhrase(queryText, nextKind.tokens, dictionaryReady);
  }

  // Shared by a keystroke and by the browser walking this screen's own
  // history: everything a text change resets, whichever one produced it.
  // Only a keystroke owes the URL a write, so a history-driven call passes
  // `schedule: false` and leaves `commitUrl` untouched.
  function applyText(nextText: string, options: { schedule: boolean }): void {
    setText(nextText);
    latestTextRef.current = nextText;
    const dictionaryReady = status.state === "ready";

    // Any keystroke supersedes whatever the phrase path was waiting on or
    // had already sent (RNL-05, rule 4).
    if (phraseDebounceRef.current) {
      clearTimeout(phraseDebounceRef.current);
      phraseDebounceRef.current = null;
    }
    phraseAbortRef.current?.abort();
    phraseAbortRef.current = null;

    if (urlSettleRef.current) {
      clearTimeout(urlSettleRef.current);
      urlSettleRef.current = null;
    }
    if (options.schedule) {
      urlSettleRef.current = setTimeout(() => {
        urlSettleRef.current = null;
        commitUrl(nextText);
      }, PHRASE_DEBOUNCE_MS);
    }

    void runQuery(nextText, dictionaryReady);
  }

  function handleTextChange(nextText: string): void {
    // An empty box is the boundary between one lookup and the next: it
    // writes nothing itself (no entry for "nothing found"), but the word
    // that follows it opens a fresh entry rather than replacing the last one.
    if (nextText === "") boundaryRef.current = true;
    applyText(nextText, { schedule: true });
  }

  async function handleEnableDevice(): Promise<void> {
    setDeviceOffer({ kind: "downloading", fraction: null });
    try {
      await enableDeviceTranslator({
        onDownloadProgress: (fraction) => setDeviceOffer({ kind: "downloading", fraction }),
      });
      deviceReadyRef.current = true;
      setDeviceOffer({ kind: "hidden" });
    } catch {
      setDeviceOffer({ kind: "offered" });
    }
  }

  // A prefix mid-word — "ru" on the way to "run" — has no exact or inflected
  // hit of its own, but `suggest` only ever returns headwords that begin
  // with it: a non-empty list is that same proof. Suppress SenseList's
  // "not found" text for as long as one stands — the ordinary silence of no
  // answer yet, not a new state. Decided by the user 2026-09-09.
  // An answer on screen is what retires the offer: `word` closes its list
  // because the entry is already below it, while `ru` keeps the ten it was
  // read from. No clock decides this — only whether there is something to
  // read. Decided by the user 2026-09-09.
  const wordFound = wordAnswer !== null && (wordAnswer.exact !== null || wordAnswer.viaInflection.length > 0);
  const suppressNotFound = !wordFound && suggestions.length > 0;

  // RL-35's decoration clause: the network is asked about a headword only
  // once its own answer is already painted, and only for the exact match —
  // an inflected-only hit (`ru` -> nothing exact) has no headword row to
  // decorate. `useDecoration` itself waits for the settle and de-dupes.
  const exactGroup = kind.kind === "word" && wordAnswer !== null ? wordAnswer.exact : null;
  const decoration = useDecoration(
    exactGroup ? exactGroup.headword : null,
    exactGroup ? needsDefinition(exactGroup) : false,
  );

  // RL-44/RL-47: the network is asked only for the two shapes the dictionary
  // itself could not close — a miss, or a hit that only came through
  // inflection. An exact headword has its own network answer already
  // (`useDecoration` above); `suppressNotFound` holding means a prefix is
  // still mid-word, and asking there would charge every paused keystroke.
  const networkWord =
    kind.kind === "word" && wordAnswer !== null && wordAnswer.exact === null && !suppressNotFound
      ? normaliseHeadword(wordAnswer.query)
      : null;
  const networkAnswer = useNetworkAnswer(networkWord);

  return (
    <Flex direction="column" gap="5">
      <Flex direction="column" gap="2">
        <SearchBox value={text} onChange={handleTextChange} />
        <InstallStatus status={status} onRetry={retry} query={text} />
      </Flex>

      {kind.kind === "empty" && (
        <Text size="2" color="gray">
          {tSearch("empty")}
        </Text>
      )}

      {kind.kind === "word" && (
        <Flex direction="column" gap="4">
          {!wordFound && <Suggestions items={suggestions} onPick={handleTextChange} />}
          {wordAnswer && !suppressNotFound && (
            <SenseList
              answer={wordAnswer}
              photo={decoration.photo}
              generated={decoration.text}
              networkAnswer={networkAnswer}
            />
          )}
        </Flex>
      )}

      {kind.kind === "phrase" &&
        (kind.tokens < PHRASE_MIN_TOKENS || kind.tokens > PHRASE_MAX_TOKENS || phraseState.kind === "failed" ? (
          noEntryState && <NoEntryAnswer state={noEntryState} />
        ) : (
          <PhraseAnswer
            source={text}
            state={phraseState}
            offer={deviceOffer}
            onEnableDevice={handleEnableDevice}
          />
        ))}
    </Flex>
  );
}
