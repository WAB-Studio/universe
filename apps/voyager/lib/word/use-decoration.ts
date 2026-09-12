"use client";

import { useEffect, useRef, useState } from "react";

import type { PhotoState } from "@/components/search/word-photo";
import type { GeneratedTextState as TextState } from "@/components/search/generated-text";
import type { InflectionRule } from "@/lib/dictionary/inflect";
import { PHRASE_DEBOUNCE_MS } from "@/lib/query/settle";
import { rememberCredit } from "./credits-store";
import { PHOTO_ENDPOINT, TEXT_ENDPOINT, photoResponseSchema, textResponseSchema } from "./protocol";

// RL-45's flexion portero: the surface the reader actually typed and the
// rule that reached `headword` from it. The server re-derives and checks
// this pair itself (route.ts) — nothing here is trusted on its own, only
// carried across the one network boundary that can name it, since the
// server never sees a keystroke.
export type InflectionClaim = { surface: string; rule: InflectionRule };

type Decoration = { photo: PhotoState; text: TextState };

const ABSENT: Decoration = { photo: { kind: "absent" }, text: { kind: "absent" } };
const PENDING: Decoration = { photo: { kind: "pending" }, text: { kind: "pending" } };

// One entry per headword for the tab's whole life (RL-35, RL-41: resolved
// "the first time someone looks that word up", never once per mount). A
// second visit to the same word in this tab reads straight from here.
const cache = new Map<string, Decoration>();

async function fetchPhoto(headword: string, signal: AbortSignal): Promise<PhotoState> {
  try {
    const response = await fetch(PHOTO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headword }),
      signal,
    });
    if (response.status !== 200) return { kind: "absent" };
    const photo = photoResponseSchema.parse(await response.json());
    return { kind: "resolved", photo };
  } catch {
    // 204, a network error and a body that fails validation all land here:
    // the reader never sees a message, a retry or an alarm for a photo.
    return { kind: "absent" };
  }
}

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
    return { kind: "absent" };
  }
}

// The one place either network call for a word's decoration leaves the
// device. Called from `search-screen.tsx` alone, with `headword` set only
// once a `word` query is classified and already painted (`wordFound`) —
// `/registro/[palabra]` never calls this, so it opens no connection.
//
// `cache` is read straight from render, not mirrored into state: a cache
// hit or a null headword is a value this hook already has, and a `setState`
// called synchronously inside the effect body for a value the render could
// derive itself is exactly what `react-hooks/set-state-in-effect` forbids.
// Only the two outcomes render cannot know ahead of time — a request now in
// flight, and one that just resolved — reach `setState`, and both do it
// from an asynchronous callback (a timer firing, a promise settling), never
// from the effect's own synchronous body. The photo and the text settle on
// their own two promises, each reaching `setState` the instant it lands —
// neither is held for the other (RL-35's board, `PalabraTextoAntesDeFoto`:
// the reserved 76px square, not the text, is what waits).
// `inflection` is absent for every caller in this slice: search-screen.tsx
// only ever passes the exact match's own headword, whose surface and rule
// disagree with nothing. A screen that later decorates an inflected-only
// hit passes the pair it already reads off `WordAnswer.viaInflection`.
export function useDecoration(
  headword: string | null,
  needDefinition: boolean,
  inflection: InflectionClaim | null = null,
): Decoration {
  const [pendingHeadword, setPendingHeadword] = useState<string | null>(null);
  const [resolved, setResolved] = useState<{ headword: string; decoration: Decoration } | null>(null);
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
      // The pending square and the pending text block only appear once a
      // request is actually in flight, never while a keystroke could still
      // replace this headword before the settle.
      setPendingHeadword(headword);

      // The photo and the text are asked for together but never awaited
      // together: whichever settles first is the one the reader sees
      // first. `photoResult`/`textResult` live in this closure, not in
      // `resolved` state, so the side still in flight has somewhere to
      // read "not yet" from without a stale headword's old answer
      // leaking into the merge.
      let photoResult: PhotoState | null = null;
      let textResult: TextState | null = null;

      // An arrow function, not a declaration: a `function` here loses
      // tsgo's narrowing of `headword` to `string`, since a hoisted
      // declaration could in principle run before the null check above.
      const commitIfSettled = () => {
        if (photoResult === null || textResult === null) return;
        cache.set(headword, { photo: photoResult, text: textResult });
      };

      void fetchPhoto(headword, controller.signal).then((photo) => {
        if (controller.signal.aborted) return;
        photoResult = photo;
        setResolved({ headword, decoration: { photo, text: textResult ?? PENDING.text } });
        commitIfSettled();
        if (photo.kind === "resolved") {
          void rememberCredit({
            headword,
            author: photo.photo.author,
            licence: photo.photo.licence,
            licenceUrl: photo.photo.licenceUrl,
            sourceUrl: photo.photo.sourceUrl,
            at: Date.now(),
          });
        }
      });

      void fetchText(headword, needDefinition, inflection, controller.signal).then((text) => {
        if (controller.signal.aborted) return;
        textResult = text;
        setResolved({ headword, decoration: { photo: photoResult ?? PENDING.photo, text } });
        commitIfSettled();
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
  if (resolved && resolved.headword === headword) return resolved.decoration;
  if (pendingHeadword === headword) return PENDING;
  return ABSENT;
}
