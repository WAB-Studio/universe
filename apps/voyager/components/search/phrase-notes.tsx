"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { normaliseHeadword } from "@/lib/dictionary/format";
import { NOTES_ENDPOINT, notesResponseSchema, type NotesResponse } from "@/lib/phrase/notes-protocol";
import { Flex, Text } from "@/components/ui";

type NotesResult = NotesResponse;

// One entry per phrase fingerprint for the tab's whole life — a phrase
// already answered costs nothing further, the same rule RNL-05 already
// keeps for the translation itself (`search-screen.tsx`'s own
// `phraseCacheRef`). Module scope, not component state: a fresh mount of
// the same phrase must still read yesterday's answer instead of asking again.
const cache = new Map<string, NotesResult>();

async function fetchNotes(source: string, translation: string, signal: AbortSignal): Promise<NotesResult> {
  try {
    const response = await fetch(NOTES_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, translation }),
      signal,
    });
    if (response.status !== 200) return { notes: [] };
    // `safeParse`, never `parse`: the route's own schema decides the shape,
    // and a body that fails it is an absence here, not an exception to raise
    // through the render.
    const parsed = notesResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : { notes: [] };
  } catch {
    // Aborted, offline, or a body a stray provider could not shape: the
    // translation already answered, so this stays the silence today's
    // screen already draws — never a message or a retry of its own.
    return { notes: [] };
  }
}

// The one leaf in this slice that asks for its own data (RL-46).
// `search-screen.tsx` owns every other request; mounting this only inside
// `PhraseAnswer`'s `done` branch is what keeps RNL-05 whole without
// teaching that file a request it does not otherwise make.
export function PhraseNotes({ source, translation }: { source: string; translation: string }) {
  const t = useTranslations("phrase");
  const fingerprint = normaliseHeadword(source);
  const [resolved, setResolved] = useState<{ fingerprint: string; result: NotesResult } | null>(null);

  useEffect(() => {
    if (cache.has(fingerprint)) return;

    const controller = new AbortController();

    void fetchNotes(source, translation, controller.signal).then((result) => {
      // The only guard this needs: a stale request's own controller is the
      // one the cleanup below already aborted, so nothing but the latest
      // invocation ever reaches this line un-aborted.
      if (controller.signal.aborted) return;
      cache.set(fingerprint, result);
      setResolved({ fingerprint, result });
    });

    // Runs on unmount and on every dependency change alike, so a phrase
    // replaced mid-flight — whether `PhraseAnswer` unmounts this leaf or
    // hands it new props directly, RNL-05's cache-hit path does the
    // latter — cancels the request its own answer would otherwise land on.
    return () => controller.abort();
  }, [fingerprint, source, translation]);

  const result = cache.get(fingerprint) ?? (resolved?.fingerprint === fingerprint ? resolved.result : null);

  if (result === null) {
    return (
      <Text size="2" muted>
        {t("notesPending")}
      </Text>
    );
  }

  // Zero notes is a valid answer (RL-46): the translation already replied,
  // and that silence is the screen as it stands today.
  if (result.notes.length === 0) return null;

  return (
    <Flex direction="column" gap="3">
      <Text size="2" muted>
        {t("notesTitle")}
      </Text>
      {result.notes.map((note, index) => (
        <Flex direction="column" gap="1" key={`${note.term}-${index}`}>
          <Text size="2" weight="bold">
            {note.term}
          </Text>
          <Text size="2">{note.note}</Text>
        </Flex>
      ))}
    </Flex>
  );
}
