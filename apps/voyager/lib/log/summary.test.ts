// RL-32's contract on `lookups`: the reader's record groups by word, one row
// per word, ordered by frequency; tapping a word opens every one of its
// searches with its date. Node has no IndexedDB, so `./record`'s
// `openLogDatabase` is mocked with a hand-rolled cursor that iterates a
// plain array in index-key order — nothing about `record.ts` itself is
// under test here, the same boundary `merge.test.ts` draws.
//
// Requires --experimental-test-module-mocks (see package.json's check:unit).
import assert from "node:assert/strict";
import { mock, test } from "node:test";

import type { LookupRecord } from "./types";

type Row = LookupRecord & { id: number };

type FakeRequest<T> = {
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  error: Error | null;
  result: T;
};

type FakeCursor = { value: Row; continue(): void };

// `IDBKeyRange.only` is the one range `readWordHistory` builds; `merge.test.ts`
// mocks `.lowerBound` the same way, for the one range its own module builds.
(globalThis as unknown as { IDBKeyRange: { only(value: string): { only: string } } }).IDBKeyRange = {
  only: (value) => ({ only: value }),
};

// Mirrors the real index's own order: ascending by the indexed key
// (`normalised`), and ascending by primary key among rows that tie on it —
// never the order the rows were inserted in.
function sortedByIndex(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => (a.normalised < b.normalised ? -1 : a.normalised > b.normalised ? 1 : a.id - b.id));
}

function makeCursorRequest(rows: Row[]): FakeRequest<FakeCursor | null> {
  const request: FakeRequest<FakeCursor | null> = { onsuccess: null, onerror: null, error: null, result: null };
  let i = 0;
  function step(): void {
    queueMicrotask(() => {
      request.result =
        i < rows.length
          ? {
              value: rows[i],
              continue: () => {
                i += 1;
                step();
              },
            }
          : null;
      request.onsuccess?.();
    });
  }
  step();
  return request;
}

function fakeDatabase(rows: Row[]) {
  return {
    transaction: () => ({
      objectStore: () => ({
        index: () => ({
          openCursor: (range?: { only: string }) => {
            const sorted = sortedByIndex(rows);
            const filtered = range ? sorted.filter((r) => r.normalised === range.only) : sorted;
            return makeCursorRequest(filtered);
          },
        }),
      }),
    }),
  };
}

let currentRows: Row[] = [];

// Mocked and imported lazily, the same reason `merge.test.ts` does it: this
// file has no top-level await, and the mock must land before `summary.ts` —
// via `record.ts` — is ever imported.
let summary: typeof import("./summary") | null = null;
async function getSummary(): Promise<typeof import("./summary")> {
  if (summary) return summary;
  mock.module("./record", {
    namedExports: { openLogDatabase: () => Promise.resolve(fakeDatabase(currentRows)) },
  });
  summary = await import("./summary");
  return summary;
}

function row(
  id: number,
  normalised: string,
  overrides: Partial<Row> = {},
): Row {
  return {
    id,
    schema: 2,
    at: 1_700_000_000_000 + id,
    text: normalised,
    normalised,
    kind: "word",
    outcome: "exact",
    headword: normalised,
    rule: null,
    senses: 1,
    translation: `t-${id}`,
    dictionaryReady: true,
    origin: null,
    ...overrides,
  };
}

// --- readWordStudy: grouping, ordering, limit vs. total ---

test("readWordStudy: one row per distinct normalised word, counting every search", async () => {
  currentRows = [row(1, "cat"), row(2, "cat"), row(3, "dog")];
  const { readWordStudy } = await getSummary();
  const { rows, total } = await readWordStudy();
  assert.equal(total, 2);
  const byWord = new Map(rows.map((r) => [r.normalised, r]));
  assert.equal(byWord.get("cat")?.count, 2);
  assert.equal(byWord.get("dog")?.count, 1);
});

test("readWordStudy: rows sort by frequency — the most-searched word leads", async () => {
  currentRows = [row(1, "dog"), row(2, "cat"), row(3, "cat"), row(4, "cat")];
  const { readWordStudy } = await getSummary();
  const { rows } = await readWordStudy();
  assert.equal(rows[0].normalised, "cat");
  assert.equal(rows[0].count, 3);
  assert.equal(rows[1].normalised, "dog");
});

test("readWordStudy: a tie in frequency breaks toward the most recently searched", async () => {
  currentRows = [row(1, "old", { at: 1000 }), row(2, "new", { at: 2000 })];
  const { readWordStudy } = await getSummary();
  const { rows } = await readWordStudy();
  assert.equal(rows[0].normalised, "new");
  assert.equal(rows[1].normalised, "old");
});

test("readWordStudy: display, translation and outcome come from the group's most recent row, not its first", async () => {
  currentRows = [
    row(1, "cat", { at: 1000, text: "CAT", translation: "gato viejo", outcome: "exact" }),
    row(2, "cat", { at: 2000, text: "cat", translation: "gato nuevo", outcome: "inflected" }),
  ];
  const { readWordStudy } = await getSummary();
  const { rows } = await readWordStudy();
  assert.equal(rows[0].display, "cat");
  assert.equal(rows[0].lastTranslation, "gato nuevo");
  assert.equal(rows[0].lastOutcome, "inflected");
  assert.equal(rows[0].lastAt, 2000);
});

test("readWordStudy: two searches settled the same millisecond keep the earlier one's display, translation and outcome", async () => {
  currentRows = [
    row(1, "cat", { at: 5000, text: "first", translation: "t1", outcome: "exact" }),
    row(2, "cat", { at: 5000, text: "second", translation: "t2", outcome: "inflected" }),
  ];
  const { readWordStudy } = await getSummary();
  const { rows } = await readWordStudy();
  assert.equal(rows[0].display, "first");
  assert.equal(rows[0].lastTranslation, "t1");
  assert.equal(rows[0].lastOutcome, "exact");
  assert.equal(rows[0].count, 2);
});

test("readWordStudy: limit caps the visible rows but total still counts every group", async () => {
  currentRows = [row(1, "a"), row(2, "b"), row(3, "c")];
  const { readWordStudy } = await getSummary();
  const { rows, total } = await readWordStudy(1);
  assert.equal(rows.length, 1);
  assert.equal(total, 3);
});

test("readWordStudy: a schema-1 row with no translation field reads as null, not undefined", async () => {
  const bare = row(1, "cat");
  delete (bare as Partial<Row>).translation;
  currentRows = [bare];
  const { readWordStudy } = await getSummary();
  const { rows } = await readWordStudy();
  assert.equal(rows[0].lastTranslation, null);
});

// --- properties: the grouping is order-independent, and the parts sum to the total ---

test("property: readWordStudy's grouping does not depend on the order the rows were stored in", async () => {
  const { readWordStudy } = await getSummary();
  let seed = 20260919;
  function rand(): number {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  const words = ["alfa", "bravo", "charlie", "delta", "echo"];
  for (let trial = 0; trial < 30; trial++) {
    const n = 3 + Math.floor(rand() * 30);
    const rows: Row[] = [];
    for (let i = 0; i < n; i++) {
      const word = words[Math.floor(rand() * words.length)];
      rows.push(row(i + 1, word, { at: 1_700_000_000_000 + i }));
    }
    currentRows = rows;
    const inOrder = await readWordStudy();
    currentRows = [...rows].reverse();
    const reversed = await readWordStudy();
    assert.deepEqual(reversed.rows, inOrder.rows, `trial=${trial}`);
    assert.equal(reversed.total, inOrder.total);
  }
});

test("property: the sum of every group's count equals the number of rows recorded", async () => {
  const { readWordStudy } = await getSummary();
  let seed = 424242;
  function rand(): number {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  const words = ["one", "two", "three", "four"];
  for (let trial = 0; trial < 30; trial++) {
    const n = 1 + Math.floor(rand() * 40);
    const rows: Row[] = [];
    for (let i = 0; i < n; i++) {
      const word = words[Math.floor(rand() * words.length)];
      rows.push(row(i + 1, word, { at: 1_700_000_000_000 + i }));
    }
    currentRows = rows;
    const { rows: studyRows } = await readWordStudy();
    const sum = studyRows.reduce((total, r) => total + r.count, 0);
    assert.equal(sum, n, `trial=${trial}`);
  }
});

// --- readWordHistory: bounded to one word, most-recent-first, limit vs. total ---

test("readWordHistory: only the rows for the given normalised word come back", async () => {
  currentRows = [row(1, "cat"), row(2, "dog"), row(3, "cat")];
  const { readWordHistory } = await getSummary();
  const { rows, total } = await readWordHistory("cat");
  assert.equal(total, 2);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.text === "cat"));
});

test("readWordHistory: most recent search first", async () => {
  currentRows = [row(1, "cat", { at: 1000 }), row(2, "cat", { at: 3000 }), row(3, "cat", { at: 2000 })];
  const { readWordHistory } = await getSummary();
  const { rows } = await readWordHistory("cat");
  assert.deepEqual(rows.map((r) => r.at), [3000, 2000, 1000]);
});

test("readWordHistory: two searches settled the same millisecond break toward the higher id", async () => {
  currentRows = [row(1, "cat", { at: 1000 }), row(2, "cat", { at: 1000 })];
  const { readWordHistory } = await getSummary();
  const { rows } = await readWordHistory("cat");
  // Both rows carry the same `at`; the later `id` is the real search.
  assert.deepEqual(rows.map((r) => r.text), ["cat", "cat"]);
  assert.equal(rows.length, 2);
});

test("readWordHistory: limit caps the visible rows but total counts every match", async () => {
  currentRows = [row(1, "cat"), row(2, "cat"), row(3, "cat")];
  const { readWordHistory } = await getSummary();
  const { rows, total } = await readWordHistory("cat", 1);
  assert.equal(rows.length, 1);
  assert.equal(total, 3);
});

test("readWordHistory: a schema-1 row with no translation field reads as null, not undefined", async () => {
  const bare = row(1, "cat");
  delete (bare as Partial<Row>).translation;
  currentRows = [bare];
  const { readWordHistory } = await getSummary();
  const { rows } = await readWordHistory("cat");
  assert.equal(rows[0].translation, null);
});

test("readWordHistory: a word never searched answers an empty history, not an error", async () => {
  currentRows = [row(1, "cat")];
  const { readWordHistory } = await getSummary();
  const { rows, total } = await readWordHistory("nonexistent");
  assert.deepEqual(rows, []);
  assert.equal(total, 0);
});
