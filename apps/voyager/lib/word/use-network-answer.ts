"use client";

import { useEffect, useRef, useState } from "react";

import type { NetworkAnswerState } from "@/components/search/network-answer";
import { PHRASE_DEBOUNCE_MS } from "@/lib/query/settle";
import { UNLISTED_ENDPOINT, unlistedResponseSchema } from "./unlisted-protocol";

const ABSENT: NetworkAnswerState = { kind: "absent" };
const PENDING: NetworkAnswerState = { kind: "pending" };
const FAILED: NetworkAnswerState = { kind: "failed" };

// One entry per word for the tab's whole life, the same rule
// `use-decoration.ts`'s cache follows: a second visit to the same word in
// this tab reads straight from here and opens no connection.
const cache = new Map<string, NetworkAnswerState>();

async function fetchAnswer(word: string, signal: AbortSignal): Promise<NetworkAnswerState> {
  try {
    const response = await fetch(UNLISTED_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word }),
      signal,
    });
    // 204 (no key, over a cap, a provider failure) and 400 (a bad request
    // this hook should never send) both land on `failed` alongside a body
    // that fails validation: RL-44 wants one shape of "could not answer",
    // never a message that reads differently depending on why.
    if (response.status !== 200) return FAILED;
    const answer = unlistedResponseSchema.parse(await response.json());
    return { kind: "resolved", answer };
  } catch {
    return FAILED;
  }
}

// The one place a request to `/api/word/unlisted` leaves the device. Mirrors
// `use-decoration.ts`'s shape exactly, for one answer instead of two: the
// same debounce, the same `AbortController` per headword change, the same
// module-scoped cache, and the same rule that `cache` is read from render,
// never mirrored into state synchronously inside the effect body — only the
// two outcomes render cannot know ahead of time (a request now in flight,
// and one that just resolved) reach `setState`, and both do it from an
// asynchronous callback, never from the effect's own synchronous body.
export function useNetworkAnswer(word: string | null): NetworkAnswerState {
  const [pendingWord, setPendingWord] = useState<string | null>(null);
  const [resolved, setResolved] = useState<{ word: string; state: NetworkAnswerState } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // A word change — including one keystroke replacing another — cancels
    // whatever the previous word was waiting on or had already sent.
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;

    if (word === null || cache.has(word)) return;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const controller = new AbortController();
      abortRef.current = controller;
      // The pending block only appears once a request is actually in
      // flight, never while a keystroke could still replace this word
      // before the settle.
      setPendingWord(word);

      void fetchAnswer(word, controller.signal).then((state) => {
        if (controller.signal.aborted) return;
        cache.set(word, state);
        setResolved({ word, state });
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
  }, [word]);

  if (word === null) return ABSENT;
  const cached = cache.get(word);
  if (cached) return cached;
  if (resolved && resolved.word === word) return resolved.state;
  if (pendingWord === word) return PENDING;
  return ABSENT;
}
