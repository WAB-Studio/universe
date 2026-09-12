"use client";

import { useEffect, useRef, useState } from "react";

import type { GeneratedTextState as TextState } from "@/components/search/generated-text";
import type { InflectionRule } from "@/lib/dictionary/inflect";
import { PHRASE_DEBOUNCE_MS } from "@/lib/query/settle";
import { TEXT_ENDPOINT, textResponseSchema } from "./protocol";

// RL-45's flexion portero: the surface the reader actually typed and the
// rule that reached `headword` from it. The server re-derives and checks
// this pair itself (route.ts) — nothing here is trusted on its own, only
// carried across the one network boundary that can name it, since the
// server never sees a keystroke.
export type InflectionClaim = { surface: string; rule: InflectionRule };

const ABSENT: TextState = { kind: "absent" };
const PENDING: TextState = { kind: "pending" };

// One entry per headword for the tab's whole life (RL-35, RL-41: resolved
// "the first time someone looks that word up", never once per mount). A
// second visit to the same word in this tab reads straight from here.
const cache = new Map<string, TextState>();

async function fetchText(
  headword: string,
  needDefinition: boolean,
  inflection: InflectionClaim | null,
  signal: AbortSignal,
): Promise<TextState> {
  try {
    const response = await fetch(TEXT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        headword,
        needDefinition,
        ...(inflection ? { surface: inflection.surface, rule: inflection.rule } : {}),
      }),
      signal,
    });
    if (response.status !== 200) return { kind: "absent" };
    const text = textResponseSchema.parse(await response.json());
    return { kind: "resolved", text };
  } catch {
    // 204, a network error and a body that fails validation all land here:
    // the reader never sees a message, a retry or an alarm for the text.
    return { kind: "absent" };
  }
}

// The one place the decoration's network call leaves the device. Called
// from `search-screen.tsx` alone, with `headword` set only once a `word`
// query is classified and already painted (`wordFound`) —
// `/registro/[palabra]` never calls this, so it opens no connection.
//
// `cache` is read straight from render, not mirrored into state: a cache
// hit or a null headword is a value this hook already has, and a `setState`
// called synchronously inside the effect body for a value the render could
// derive itself is exactly what `react-hooks/set-state-in-effect` forbids.
// Only the two outcomes render cannot know ahead of time — a request now in
// flight, and one that just resolved — reach `setState`, and both do it
// from an asynchronous callback (a timer firing, a promise settling), never
// from the effect's own synchronous body.
// `inflection` is absent for every caller in this slice: search-screen.tsx
// only ever passes the exact match's own headword, whose surface and rule
// disagree with nothing. A screen that later decorates an inflected-only
// hit passes the pair it already reads off `WordAnswer.viaInflection`.
export function useDecoration(
  headword: string | null,
  needDefinition: boolean,
  inflection: InflectionClaim | null = null,
): TextState {
  const [pendingHeadword, setPendingHeadword] = useState<string | null>(null);
  const [resolved, setResolved] = useState<{ headword: string; text: TextState } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // A word change — including one keystroke replacing another — cancels
    // whatever the previous headword was waiting on or had already sent.
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;

    if (headword === null || cache.has(headword)) return;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const controller = new AbortController();
      abortRef.current = controller;
      // The pending text block only appears once a request is actually in
      // flight, never while a keystroke could still replace this headword
      // before the settle.
      setPendingHeadword(headword);

      void fetchText(headword, needDefinition, inflection, controller.signal).then((text) => {
        if (controller.signal.aborted) return;
        cache.set(headword, text);
        setResolved({ headword, text });
      });
    }, PHRASE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [headword, needDefinition, inflection]);

  if (headword === null) return ABSENT;
  const cached = cache.get(headword);
  if (cached) return cached;
  if (resolved && resolved.headword === headword) return resolved.text;
  if (pendingHeadword === headword) return PENDING;
  return ABSENT;
}
