/**
 * Drives `admitWord`'s form check over the shipped asset, then the real
 * `reading.client_spend` table `claimClientCall` writes to.
 *
 * `client-budget.ts` starts with `import "server-only"`, which throws under
 * plain Node (no such package outside a Next build), so this script
 * reimplements its two functions' bodies directly rather than re-importing
 * them — the same reason `check-decoration.ts`, `check-sync.ts` and
 * `purge-unphotographable-photos.ts` open their own `postgres` client
 * instead of importing `db/client.ts`. `admit.ts` carries no such import and
 * is imported for real below.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import postgres from "postgres";

import { admitWord } from "../lib/word/admit";
import { manifestSchema, type DictionaryPayload } from "../lib/dictionary/format";
import { buildIndex } from "../lib/dictionary/index-build";

const APP_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(APP_DIR, "public");
const MANIFEST_FULL_PATH = path.join(PUBLIC_DIR, "dictionary", "manifest.json");

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

const manifest = manifestSchema.parse(JSON.parse(readFileSync(MANIFEST_FULL_PATH, "utf8")));
const assetFullPath = path.join(PUBLIC_DIR, manifest.asset.path.replace(/^\//, ""));
const payload = JSON.parse(readFileSync(assetFullPath, "utf8")) as DictionaryPayload;
const index = buildIndex(payload);
const lemmas = index.sortedHeadwords;

const admittedShape = lemmas.filter((lemma) => admitWord(lemma) !== null).length;
console.log(
  `Form check over the shipped index: ${admittedShape} of ${lemmas.length} lemmas admitted ` +
    `(${((100 * admittedShape) / lemmas.length).toFixed(1)}%)`,
);
console.log("");

const ADMITTED = ["whereat", "coccidiosis", "mangels", "milk-pails", "swishing", "sternly"];
const REJECTED = ["hello world", "a", "a".repeat(64), "snuff'; drop table --", "<script>", "café", "12345", ""];

console.log("admitWord on the admitted list:");
for (const word of ADMITTED) console.log(`  ${JSON.stringify(word)} -> ${JSON.stringify(admitWord(word))}`);
console.log("admitWord on the rejected list:");
for (const word of REJECTED) console.log(`  ${JSON.stringify(word)} -> ${JSON.stringify(admitWord(word))}`);
console.log("");

for (const word of ADMITTED) {
  assert(next(`admitWord admits "${word}"`), admitWord(word) !== null, `admitWord("${word}") = ${admitWord(word)}`);
}
for (const word of REJECTED) {
  assert(
    next(`admitWord rejects ${JSON.stringify(word)}`),
    admitWord(word) === null,
    `admitWord(${JSON.stringify(word)}) = ${JSON.stringify(admitWord(word))}`,
  );
}

// clientKey's body, reimplemented (see the file header): a caller with
// `x-forwarded-for` set but no salt configured must still get no key — a
// budget that cannot be charged is a budget that does not exist.
function clientKey(request: Request, salt: string | undefined): string | null {
  if (!salt) return null;
  const forwardedFor = request.headers.get("x-forwarded-for");
  const address = forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim();
  if (!address) return null;
  return createHash("sha256").update(`${salt}:${address}`).digest("hex");
}

{
  const request = new Request("http://localhost/api/word/unlisted", {
    headers: { "x-forwarded-for": "203.0.113.9" },
  });
  assert(
    next("clientKey returns null with no CLIENT_KEY_SALT configured"),
    clientKey(request, undefined) === null,
    `clientKey(..., undefined) = ${JSON.stringify(clientKey(request, undefined))}`,
  );
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const PROBE_CLIENT = "check-admission-probe";

  async function claimClientCall(client: string): Promise<number> {
    const [row] = await sql<{ calls: number }[]>`
      insert into reading.client_spend as cs (day, client, calls)
      values (current_date, ${client}, 1)
      on conflict (day, client) do update set calls = cs.calls + 1
      returning cs.calls
    `;
    return row.calls;
  }

  const first = await claimClientCall(PROBE_CLIENT);
  const second = await claimClientCall(PROBE_CLIENT);
  assert(next("claimClientCall bumps 1 then 2 against the real database"), first === 1 && second === 2, `first=${first} second=${second}`);

  const deleted = await sql`
    delete from reading.client_spend where day = current_date and client = ${PROBE_CLIENT}
  `;
  console.log(`Cleanup: deleted ${deleted.count} row(s) for client "${PROBE_CLIENT}"`);
  assert(next("the probe row is deleted before this script exits"), deleted.count === 1, `deleted.count=${deleted.count}`);

  await sql.end();

  console.log("");
  console.log(`REPORT  ${passes} pass, ${failures} fail`);
  process.exit(failed ? 1 : 0);
}

main();
