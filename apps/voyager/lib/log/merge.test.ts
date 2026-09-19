// RL-24's contract on `lookups`: a copy never edits a row, copying it twice
// never duplicates it, and what one device sends never overwrites what
// another wrote. Node has no IndexedDB, so `./record`'s `openLogDatabase`
// is mocked with a hand-rolled stand-in that implements only the two calls
// `readSince` and `mergeForeign` actually make against it — nothing about
// `record.ts` itself is under test here.
//
// Requires --experimental-test-module-mocks (see package.json's check:unit).
import assert from "node:assert/strict";
import { mock, test } from "node:test";

type Row = Record<string, unknown>;

class FakeStore {
  rows = new Map<number, Row>();
  seq = 0;
}

type KeyRange = { lower: number; lowerOpen: boolean };

type FakeRequest<T> = {
  onsuccess: (() => void) | null;
  onerror: ((event: { preventDefault(): void }) => void) | null;
  error: Error | null;
  result: T;
};

function makeRequest<T>(initial: T): FakeRequest<T> {
  return { onsuccess: null, onerror: null, error: null, result: initial };
}

type FakeStoreHandle = {
  add(value: Row): FakeRequest<number | undefined>;
  getAll(query?: KeyRange, limit?: number): FakeRequest<Row[]>;
};

function makeStoreHandle(
  store: FakeStore,
  begin: () => void,
  end: () => void,
  abort: (error: Error) => void,
): FakeStoreHandle {
  return {
    add(value) {
      const request = makeRequest<number | undefined>(undefined);
      begin();
      queueMicrotask(() => {
        const record: Row = { ...value };
        const device = record.device;
        const deviceSeq = record.deviceSeq;
        // Mirrors the real "foreign" compound index: a key with either half
        // missing never enters it, so a local row never collides on it.
        if (device != null && deviceSeq != null) {
          for (const existing of store.rows.values()) {
            if (existing.device === device && existing.deviceSeq === deviceSeq) {
              const error = new Error("constraint");
              error.name = "ConstraintError";
              request.error = error;
              let prevented = false;
              request.onerror?.({
                preventDefault: () => {
                  prevented = true;
                },
              });
              if (prevented) end();
              else abort(error);
              return;
            }
          }
        }
        store.seq += 1;
        record.id = store.seq;
        store.rows.set(store.seq, record);
        request.result = store.seq;
        request.onsuccess?.();
        end();
      });
      return request;
    },
    getAll(query, limit) {
      const request = makeRequest<Row[]>([]);
      begin();
      queueMicrotask(() => {
        let rows = [...store.rows.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
        if (query) {
          rows = rows.filter((row) => {
            const id = row.id as number;
            return query.lowerOpen ? id > query.lower : id >= query.lower;
          });
        }
        if (typeof limit === "number") rows = rows.slice(0, limit);
        request.result = rows;
        request.onsuccess?.();
        end();
      });
      return request;
    },
  };
}

type FakeTransaction = {
  oncomplete: (() => void) | null;
  onabort: (() => void) | null;
  error: Error | null;
  objectStore(): FakeStoreHandle;
};

// One transaction per call, like the real thing: it completes once every
// request opened on it has settled, never before and never twice.
function makeTransaction(store: FakeStore): FakeTransaction {
  let pending = 0;
  let settled = false;

  function begin(): void {
    pending += 1;
  }
  function end(): void {
    pending -= 1;
    if (pending === 0 && !settled) {
      queueMicrotask(() => {
        if (!settled) {
          settled = true;
          transaction.oncomplete?.();
        }
      });
    }
  }
  function abort(error: Error): void {
    if (settled) return;
    settled = true;
    transaction.error = error;
    queueMicrotask(() => transaction.onabort?.());
  }

  const transaction: FakeTransaction = {
    oncomplete: null,
    onabort: null,
    error: null,
    objectStore: () => makeStoreHandle(store, begin, end, abort),
  };
  return transaction;
}

// `readSince` calls this global directly, never through `./record`.
(globalThis as unknown as { IDBKeyRange: { lowerBound(lower: number, open?: boolean): KeyRange } }).IDBKeyRange = {
  lowerBound: (lower, open) => ({ lower, lowerOpen: !!open }),
};

// Reassigned between tests, never mutated in place: `openLogDatabase`
// below reads it fresh on every call, so a new store takes effect on the
// very next call either function makes.
let currentStore = new FakeStore();

// Mocked and imported lazily, inside the first test that needs it: this
// file has no "type": "module" to grant it top-level await, and the mock
// must land before `merge.ts` — via `record.ts` — is ever imported.
let merge: typeof import("./merge") | null = null;

async function getMerge(): Promise<typeof import("./merge")> {
  if (merge) return merge;
  mock.module("./record", {
    namedExports: {
      openLogDatabase: () => Promise.resolve({ transaction: () => makeTransaction(currentStore) }),
    },
  });
  merge = await import("./merge");
  return merge;
}

function foreignRow(device: string, deviceSeq: number, overrides: Partial<Row> = {}) {
  return {
    schema: 2,
    at: 1_700_000_000_000 + deviceSeq,
    text: `word-${deviceSeq}`,
    normalised: `word-${deviceSeq}`,
    kind: "word" as const,
    outcome: "exact" as const,
    headword: `word-${deviceSeq}`,
    rule: null,
    senses: 1,
    translation: "x",
    dictionaryReady: true,
    origin: null,
    device,
    deviceSeq,
    ...overrides,
  };
}

test("readSince: a foreign row never goes back up — only local rows come back", async () => {
  const { readSince } = await getMerge();
  currentStore = new FakeStore();
  currentStore.rows.set(1, { id: 1, text: "a" });
  currentStore.rows.set(2, { id: 2, text: "b", device: "other", deviceSeq: 1 });
  currentStore.rows.set(3, { id: 3, text: "c" });
  const rows = await readSince(0, 10);
  assert.deepEqual(rows.map((r) => r.id), [1, 3]);
});

test("readSince: only rows above afterLocalId, exclusive", async () => {
  const { readSince } = await getMerge();
  currentStore = new FakeStore();
  for (const id of [1, 2, 3, 4]) currentStore.rows.set(id, { id, text: `row-${id}` });
  const rows = await readSince(2, 10);
  assert.deepEqual(rows.map((r) => r.id), [3, 4]);
});

test("readSince: at most limit rows", async () => {
  const { readSince } = await getMerge();
  currentStore = new FakeStore();
  for (const id of [1, 2, 3, 4, 5]) currentStore.rows.set(id, { id, text: `row-${id}` });
  const rows = await readSince(0, 2);
  assert.deepEqual(rows.map((r) => r.id), [1, 2]);
});

test("readSince: rows come back in key order, whatever order they were stored in", async () => {
  const { readSince } = await getMerge();
  currentStore = new FakeStore();
  for (const id of [3, 1, 2]) currentStore.rows.set(id, { id, text: `row-${id}` });
  const rows = await readSince(0, 10);
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3]);
});

test("mergeForeign: a fresh batch lands whole, and reports how many rows entered", async () => {
  const { mergeForeign } = await getMerge();
  currentStore = new FakeStore();
  const rows = Array.from({ length: 10 }, (_, i) => foreignRow("dev-a", i));
  const inserted = await mergeForeign(rows);
  assert.equal(inserted, 10);
  assert.equal(currentStore.rows.size, 10);
});

test("RL-24: copying the same rows twice does not duplicate them", async () => {
  const { mergeForeign } = await getMerge();
  currentStore = new FakeStore();
  const rows = Array.from({ length: 5 }, (_, i) => foreignRow("dev-b", i));
  await mergeForeign(rows);
  const second = await mergeForeign(rows);
  assert.equal(second, 0);
  assert.equal(currentStore.rows.size, 5);
});

test("mergeForeign is order-independent: the same set merged in a different order lands the same final rows", async () => {
  const { mergeForeign } = await getMerge();
  const rows = Array.from({ length: 12 }, (_, i) => foreignRow("dev-c", i));
  const shuffled = [...rows].reverse();

  currentStore = new FakeStore();
  await mergeForeign(rows);
  const inOrder = [...currentStore.rows.values()].map((r) => `${r.device}:${r.deviceSeq}`).sort();

  currentStore = new FakeStore();
  await mergeForeign(shuffled);
  const reversed = [...currentStore.rows.values()].map((r) => `${r.device}:${r.deviceSeq}`).sort();

  assert.deepEqual(inOrder, reversed);
});

test("mergeForeign: a merge larger than one batch still lands every row, none lost and none doubled", async () => {
  const { mergeForeign } = await getMerge();
  currentStore = new FakeStore();
  const rows = Array.from({ length: 1200 }, (_, i) => foreignRow("dev-d", i));
  const inserted = await mergeForeign(rows);
  assert.equal(inserted, 1200);
  assert.equal(currentStore.rows.size, 1200);
  const seqs = [...currentStore.rows.values()].map((r) => r.deviceSeq as number).sort((a, b) => a - b);
  assert.deepEqual(seqs, rows.map((_, i) => i));
});

test("RL-24: what one device copied is never overwritten by a later resend of the same row", async () => {
  const { mergeForeign } = await getMerge();
  currentStore = new FakeStore();
  const original = foreignRow("dev-e", 0, { text: "first" });
  await mergeForeign([original]);
  const resend = foreignRow("dev-e", 0, { text: "second, stale" });
  const inserted = await mergeForeign([resend]);
  assert.equal(inserted, 0);
  const stored = [...currentStore.rows.values()].find((r) => r.device === "dev-e" && r.deviceSeq === 0);
  assert.equal(stored?.text, "first");
});

test("mergeForeign never touches a pre-existing local row", async () => {
  const { mergeForeign } = await getMerge();
  currentStore = new FakeStore();
  currentStore.rows.set(1, { id: 1, text: "local", normalised: "local" });
  currentStore.seq = 1; // the local row already claimed key 1
  await mergeForeign([foreignRow("dev-f", 0)]);
  assert.deepEqual(currentStore.rows.get(1), { id: 1, text: "local", normalised: "local" });
});
