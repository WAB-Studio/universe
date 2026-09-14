/**
 * Drives `POST /api/word/unlisted` against a real running server and the
 * real database — never asserted from the route's source, per AGENTS.md
 * ("Verification"). `admit.ts`, `index-build.ts` and `lookup.ts` carry no
 * `server-only` import and are imported for real below; `client-budget.ts`
 * and `spend.ts` do, so their two functions' bodies are reimplemented here
 * directly, the same reason `check-admission.ts` and `check-decoration.ts`
 * open their own `postgres` connection instead of `db/client.ts`.
 *
 * Three assertions spend a real model call, on purpose and no more than the
 * three the module's "done when" names: a cold "coccidiosis", a cold
 * "swishing", and a cold "vandrossity" behind a per-caller cap of one.
 * Everything else is a cache hit, a 400 refused before the network, or a
 * 204 refused before the model.
 *
 * `WORD_UNLISTED_DAILY_CLIENT_CAP` unset and pinned at `1` are two configs
 * this repo never runs with at once, so this script spawns its own `next
 * dev` for each — the same pattern `check-decoration.ts`'s T17 uses. Next
 * 16 allows only one dev server per directory (AGENTS.md, "Run one instance
 * per worktree"): the three phases below, including the ordinary-config one
 * that answers D1 through D8, run one at a time, each torn down before the
 * next starts. Any dev server already up on this port when the script
 * starts — an operator's own, left running for manual poking — is stopped
 * first, the same `fuser -k <port>/tcp` AGENTS.md names.
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

import { admitWord } from "../lib/word/admit";
import type { DictionaryPayload } from "../lib/dictionary/format";
import { buildIndex } from "../lib/dictionary/index-build";
import { lookupWord } from "../lib/dictionary/lookup";

const PORT = Number(new URL(process.env.VOYAGER_BASE_URL ?? "http://localhost:3103").port || "3103");
const BASE_URL = `http://127.0.0.1:${PORT}`;
const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const NEXT_BIN = resolvePath(APP_DIR, "../../node_modules/.bin/next");
const CHILD_READY_TIMEOUT_MS = 60_000;

// Real dictionary/admission shapes, driven above for real. `coccidiosis`
// has no entry and no inflection of one; `swishing` is `swish` + `-ing`;
// `snuff` is a real headword — this route's turf is what the dictionary has
// nothing on, so a word it does carry belongs to `/api/word/text` instead.
const UNLISTED_WORD = "coccidiosis";
const INFLECTED_WORD = "swishing";
const INFLECTED_LEMMA = "swish";
const INFLECTED_RULE = "ing";
const LISTED_WORD = "snuff";
const SENTENCE = "hello world";
// Never requested anywhere else in this repo — free to spend a real cold
// call against without colliding with another script's fixture or cache.
const CAP_UNSET_WORD = "quorlisking";
const CAP_ONE_WORD = "vandrossity";

// Dedicated caller identities, never shared with a reader session: distinct
// IPs so each cap test's `client_spend` counter starts today at zero and
// none of the three interferes with either of the other two.
const MAIN_CALLER_IP = "203.0.113.50";
const CAP_UNSET_CALLER_IP = "203.0.113.66";
const CAP_ONE_CALLER_IP = "203.0.113.77";

let counter = 0;
let failed = false;
let passes = 0;
let failures = 0;

function next(name: string): string {
  counter += 1;
  return `D${counter}. ${name}`;
}

function assert(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (ok) passes += 1;
  else {
    failures += 1;
    failed = true;
  }
}

// `clientKey`'s body (`lib/word/client-budget.ts`), reimplemented because
// that file opens with `import "server-only"` (see the file header above).
function clientKey(address: string, salt: string | undefined): string | null {
  if (!salt) return null;
  return createHash("sha256").update(`${salt}:${address}`).digest("hex");
}

const CLIENT_KEY_SALT = process.env.CLIENT_KEY_SALT;

async function requestUnlisted(
  word: string,
  callerIp: string,
  baseUrl: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}/api/word/unlisted`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": callerIp },
    body: JSON.stringify({ word }),
  });
  const body = response.status === 200 ? await response.json() : null;
  return { status: response.status, body };
}

function startApp(env: NodeJS.ProcessEnv): { child: ChildProcess; output: string[] } {
  const output: string[] = [];
  const child = spawn(NEXT_BIN, ["dev", "--port", String(PORT)], {
    cwd: APP_DIR,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  return { child, output };
}

// Fails fast on "Another next dev server is already running" rather than
// waiting the full deadline for a bind that will never happen — the one
// clash this directory-locked dev server can raise.
async function waitForReady(output: string[], deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    if (output.join("").includes("Another next dev server is already running")) return false;
    try {
      await fetch(BASE_URL, { signal: AbortSignal.timeout(2_000) });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

function stopApp(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // Already gone — nothing left to signal.
  }
}

function freePort(): void {
  try {
    execSync(`fuser -k ${PORT}/tcp`, { stdio: "ignore" });
  } catch {
    // Nothing was listening — the port was already free.
  }
}

/** One phase, one `next dev`, one config — never two of this directory's server alive at once. */
async function runPhase<T>(env: NodeJS.ProcessEnv, run: (baseUrl: string) => Promise<T>): Promise<T> {
  freePort();
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const { child, output } = startApp(env);
  try {
    const ready = await waitForReady(output, Date.now() + CHILD_READY_TIMEOUT_MS);
    if (!ready) {
      throw new Error(`the server on :${PORT} never came up — ${output.join("").slice(-1_500) || "no output"}`);
    }
    return await run(BASE_URL);
  } finally {
    stopApp(child);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

  type WordAnswerRow = {
    word: string;
    lemma: string | null;
    rule: string | null;
    translations: string[];
    definition: string | null;
    example_en: string;
    example_es: string;
    model: string;
  };
  type ModelSpendRow = { calls: number };

  async function wordAnswerRow(word: string): Promise<WordAnswerRow | undefined> {
    const [row] = await sql<WordAnswerRow[]>`select * from reading.word_answers where word = ${word}`;
    return row;
  }
  async function deleteWordAnswer(word: string): Promise<number> {
    const result = await sql`delete from reading.word_answers where word = ${word}`;
    return result.count;
  }
  async function deleteClientSpend(client: string | null): Promise<number> {
    if (!client) return 0;
    const result = await sql`delete from reading.client_spend where day = current_date and client = ${client}`;
    return result.count;
  }
  async function readModelSpendCalls(): Promise<number> {
    const [row] = await sql<ModelSpendRow[]>`select calls from reading.model_spend where day = current_date`;
    return row?.calls ?? 0;
  }

  // A leftover from a run this script never finished must not pass the
  // "no row before" reasoning below — clear the fixtures' own slots first.
  const rowsClearedBeforeStart =
    (await deleteWordAnswer(UNLISTED_WORD)) +
    (await deleteWordAnswer(INFLECTED_WORD)) +
    (await deleteWordAnswer(CAP_UNSET_WORD)) +
    (await deleteWordAnswer(CAP_ONE_WORD));
  if (rowsClearedBeforeStart > 0) {
    console.log(`Cleared ${rowsClearedBeforeStart} leftover row(s) from an earlier run before starting.`);
  }

  // The form check and the dictionary check this route's own contract
  // leans on, driven once here for real (the shipped asset, not a mock).
  const assetPayload = JSON.parse(
    readFileSync(path.join(APP_DIR, "public", "dictionary", "eng-spa-2025.11.23.json"), "utf8"),
  ) as DictionaryPayload;
  const index = buildIndex(assetPayload);
  const unlistedLookup = lookupWord(index, admitWord(UNLISTED_WORD) ?? UNLISTED_WORD);
  assert(
    next(`"${UNLISTED_WORD}" carries no exact entry and no inflection`),
    unlistedLookup.exact === null && unlistedLookup.viaInflection.length === 0,
    `exact=${Boolean(unlistedLookup.exact)}, viaInflection=${unlistedLookup.viaInflection.length}`,
  );
  const inflectedLookup = lookupWord(index, admitWord(INFLECTED_WORD) ?? INFLECTED_WORD);
  assert(
    next(`"${INFLECTED_WORD}" traces to "${INFLECTED_LEMMA}" via "${INFLECTED_RULE}"`),
    inflectedLookup.viaInflection[0]?.lemma === INFLECTED_LEMMA &&
      inflectedLookup.viaInflection[0]?.rule === INFLECTED_RULE,
    `viaInflection[0]=${JSON.stringify(inflectedLookup.viaInflection[0])}`,
  );

  let firstBody: unknown;

  // Phase 1 — the ordinary config, unmodified: D1 through D8.
  await runPhase(process.env, async (baseUrl) => {
    // D_ — a cold, genuinely unlisted word answers 200 with a translation,
    // an English definition and a two-sided example.
    const first = await requestUnlisted(UNLISTED_WORD, MAIN_CALLER_IP, baseUrl);
    firstBody = first.body;
    const firstParsed = first.body as {
      translations?: string[];
      definition?: string | null;
      example?: { en?: string; es?: string };
    } | null;
    assert(
      next(`"${UNLISTED_WORD}" answers 200 with a translation, a definition and a two-sided example`),
      first.status === 200 &&
        Array.isArray(firstParsed?.translations) &&
        firstParsed.translations.length >= 1 &&
        firstParsed.translations.every((t) => t.length > 0) &&
        typeof firstParsed?.definition === "string" &&
        firstParsed.definition.length > 0 &&
        typeof firstParsed?.example?.en === "string" &&
        firstParsed.example.en.length > 0 &&
        typeof firstParsed?.example?.es === "string" &&
        firstParsed.example.es.length > 0,
      `status=${first.status}, body=${JSON.stringify(firstParsed)}`,
    );

    // D_ — the second identical request is a cache hit: the same body, and
    // the global spend counter reads the same number immediately before and
    // immediately after — never inferred, both reads taken around the call.
    const callsBefore = await readModelSpendCalls();
    const second = await requestUnlisted(UNLISTED_WORD, MAIN_CALLER_IP, baseUrl);
    const callsAfter = await readModelSpendCalls();
    assert(
      next(`the second identical request for "${UNLISTED_WORD}" answers the same body`),
      second.status === 200 && JSON.stringify(second.body) === JSON.stringify(firstBody),
      `status=${second.status}, same body=${JSON.stringify(second.body) === JSON.stringify(firstBody)}`,
    );
    assert(
      next("reading.model_spend.calls reads the same number before and after the cache hit"),
      callsBefore === callsAfter,
      `before=${callsBefore}, after=${callsAfter}`,
    );

    // D_ — an inflected form answers with its own lemma and rule, and a
    // translation of the form.
    const inflected = await requestUnlisted(INFLECTED_WORD, MAIN_CALLER_IP, baseUrl);
    const inflectedBody = inflected.body as { translations?: string[]; lemma?: string | null; rule?: string | null } | null;
    assert(
      next(`"${INFLECTED_WORD}" answers with lemma "${INFLECTED_LEMMA}", rule "${INFLECTED_RULE}"`),
      inflected.status === 200 &&
        inflectedBody?.lemma === INFLECTED_LEMMA &&
        inflectedBody?.rule === INFLECTED_RULE &&
        Array.isArray(inflectedBody?.translations) &&
        inflectedBody.translations.length >= 1,
      `status=${inflected.status}, body=${JSON.stringify(inflectedBody)}`,
    );

    // D_/D_ — a listed word and a multi-word string are both refused as
    // 400: the first belongs to `/api/word/text`, the second is not a
    // single word.
    const listed = await requestUnlisted(LISTED_WORD, MAIN_CALLER_IP, baseUrl);
    assert(next(`"${LISTED_WORD}" (the dictionary has it) answers 400`), listed.status === 400, `status=${listed.status}`);
    const sentence = await requestUnlisted(SENTENCE, MAIN_CALLER_IP, baseUrl);
    assert(next(`"${SENTENCE}" (not one word) answers 400`), sentence.status === 400, `status=${sentence.status}`);
  });

  // Phase 2 — WORD_UNLISTED_DAILY_CLIENT_CAP unset: a cold word answers 204
  // and reading.word_answers gains no row for it. `delete`-ing the key from
  // the child's env is not enough: Next reloads `.env.local` itself inside
  // the child process and only skips a key already present in `process.env`
  // when the child starts, so a deleted key comes right back. An empty
  // string stays present, wins over the file, and `env.ts`'s own
  // `emptyStringAsUndefined` turns it into the same `undefined` the route
  // checks for.
  const envWithoutCap: NodeJS.ProcessEnv = { ...process.env, WORD_UNLISTED_DAILY_CLIENT_CAP: "" };
  await runPhase(envWithoutCap, async (baseUrl) => {
    const response = await requestUnlisted(CAP_UNSET_WORD, CAP_UNSET_CALLER_IP, baseUrl);
    const row = await wordAnswerRow(CAP_UNSET_WORD);
    assert(
      next(`with no WORD_UNLISTED_DAILY_CLIENT_CAP, "${CAP_UNSET_WORD}" answers 204 and writes no row`),
      response.status === 204 && !row,
      `status=${response.status}, row written=${Boolean(row)}`,
    );
  });

  // Phase 3 — the per-caller cap pinned at 1: the same caller's second cold
  // word the same day answers 204; the first still answers 200 and spends
  // the one real call this test needs.
  const envCapOne: NodeJS.ProcessEnv = { ...process.env, WORD_UNLISTED_DAILY_CLIENT_CAP: "1" };
  await runPhase(envCapOne, async (baseUrl) => {
    const firstCold = await requestUnlisted(CAP_ONE_WORD, CAP_ONE_CALLER_IP, baseUrl);
    assert(
      next(`with the per-caller cap at 1, the caller's first cold word "${CAP_ONE_WORD}" answers 200`),
      firstCold.status === 200,
      `status=${firstCold.status}`,
    );
    const secondCold = await requestUnlisted(CAP_UNSET_WORD, CAP_ONE_CALLER_IP, baseUrl);
    const secondColdRow = await wordAnswerRow(CAP_UNSET_WORD);
    assert(
      next(`with the per-caller cap at 1, the same caller's second cold word "${CAP_UNSET_WORD}" answers 204 the same day`),
      secondCold.status === 204 && !secondColdRow,
      `status=${secondCold.status}, row written=${Boolean(secondColdRow)}`,
    );
  });

  // Cleanup: delete every row this run's own model calls wrote, and every
  // client_spend row this run's own dedicated caller identities bumped —
  // never a row this script did not write itself.
  let rowsDeleted = 0;
  rowsDeleted += await deleteWordAnswer(UNLISTED_WORD);
  rowsDeleted += await deleteWordAnswer(INFLECTED_WORD);
  rowsDeleted += await deleteWordAnswer(CAP_ONE_WORD);
  // Never written on a passing run — both phases that touch it must refuse
  // before the model — but deleted here too, so a defect that does write it
  // never survives this script.
  rowsDeleted += await deleteWordAnswer(CAP_UNSET_WORD);
  const mainClient = clientKey(MAIN_CALLER_IP, CLIENT_KEY_SALT);
  const capOneClient = clientKey(CAP_ONE_CALLER_IP, CLIENT_KEY_SALT);
  // Never claimed on a passing run — phase 2's config gate must refuse
  // before `claimClientCall` — but deleted here too, for the same reason
  // `CAP_UNSET_WORD` is deleted above rather than assumed absent.
  const capUnsetClient = clientKey(CAP_UNSET_CALLER_IP, CLIENT_KEY_SALT);
  const clientRowsDeleted =
    (await deleteClientSpend(mainClient)) + (await deleteClientSpend(capOneClient)) + (await deleteClientSpend(capUnsetClient));

  console.log(`Cleanup: deleted ${rowsDeleted} reading.word_answers row(s) this run wrote.`);
  console.log(`Cleanup: deleted ${clientRowsDeleted} reading.client_spend row(s) this run's own callers bumped.`);
  assert(
    next("this run leaves reading.word_answers with none of its own fixture rows"),
    !(await wordAnswerRow(UNLISTED_WORD)) &&
      !(await wordAnswerRow(INFLECTED_WORD)) &&
      !(await wordAnswerRow(CAP_ONE_WORD)) &&
      !(await wordAnswerRow(CAP_UNSET_WORD)),
    "checked after cleanup",
  );

  await sql.end();

  console.log("");
  console.log(`REPORT  ${passes} pass, ${failures} fail`);
  process.exit(failed ? 1 : 0);
}

main();
