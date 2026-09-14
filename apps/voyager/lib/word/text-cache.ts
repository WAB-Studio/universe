import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { WordText } from "@/lib/word/protocol";

type CachedRow = {
  definition: string | null;
  example_en: string;
  example_es: string;
  translations: string[] | null;
  translations_asked: boolean;
};

// `translationsAsked` is cache metadata alone — the wire response never
// carries it, only `translations` does.
export type CachedText = WordText & { translationsAsked: boolean };

/** The one round trip the hot path pays. A miss returns `null`, never throws. */
export async function readCachedText(headword: string): Promise<CachedText | null> {
  const [row] = await db.execute<CachedRow>(sql`
    select definition, example_en, example_es, translations, translations_asked
    from reading.word_texts
    where headword = ${headword}
  `);
  if (!row) return null;
  return {
    definition: row.definition,
    example: { en: row.example_en, es: row.example_es },
    translations: row.translations,
    translationsAsked: row.translations_asked,
  };
}

/**
 * Written once, on an accepted model answer alone — a failure leaves no row,
 * so the daily cap is what bounds a word that keeps failing, never a bad
 * row on disk. `on conflict do nothing`: two cold readers racing the same
 * headword both pay the call (no lock added, the same trade module 4 makes
 * for photos), and whichever insert lands first is the one every later
 * reader sees.
 *
 * `translations` binds through `sql.param`, never a bare `${array}`: inside
 * a plain value position drizzle's own `sql` expands a JS array into a
 * parenthesised list (`docs/TRAPS.md`, "An array binding is not an array"),
 * and `sql.param` is the one wrapper that reaches the driver as itself.
 */
export async function writeCachedText(
  headword: string,
  model: string,
  definition: string | null,
  exampleEn: string,
  exampleEs: string,
  translations: readonly string[] | null,
  translationsAsked: boolean,
): Promise<void> {
  await db.execute(sql`
    insert into reading.word_texts
      (headword, definition, example_en, example_es, model, translations, translations_asked)
    values
      (${headword}, ${definition}, ${exampleEn}, ${exampleEs}, ${model},
       ${sql.param(translations)}, ${translationsAsked})
    on conflict (headword) do nothing
  `);
}

/**
 * RL-45's backfill: a row `writeCachedText` wrote before this column asked
 * anything, or one whose first ask never fired (no key, over the cap). The
 * definition and example it already carries are left untouched — only
 * `translations` and the flag move, and the flag moves whether or not the
 * model found anything, so this row is never asked twice.
 */
export async function markTranslationsAsked(
  headword: string,
  translations: readonly string[] | null,
): Promise<void> {
  await db.execute(sql`
    update reading.word_texts
    set translations = ${sql.param(translations)}, translations_asked = true
    where headword = ${headword}
  `);
}
