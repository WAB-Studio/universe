/**
 * Breaks the lines a branch actually changed, one at a time, and proves
 * `check:unit` notices — never asserted from the catalog, driven against
 * the real suite (AGENTS.md, "Verification"). Restores every file from git
 * the instant its mutant is judged, never with `git stash`: this worktree
 * shares one `refs/stash` with every other lane (AGENTS.md, "Parallel
 * tracks"), and a `pop` here can carry off another lane's tree.
 *
 * File selection: `git log <merge-base>..HEAD --name-only` against the
 * branch named by `--base` (default `integracion`), never the whole repo.
 * A caller can name files directly instead — `node --import tsx
 * scripts/check-mutants.ts lib/dictionary/inflect.ts` — to drive the
 * catalog over files the current branch did not itself touch; the same
 * exclusions still apply. A test, a fixture, a `scripts/check-*` and
 * anything under `e2e/` are never mutated either way: breaking the proof
 * itself would never be noticed by the proof.
 *
 * The catalog is textual, not a parser's: each mutator matches a pattern
 * on one line and rewrites just the one occurrence it found, so a single
 * line with two candidates yields two separate mutants. "Killed" means
 * `check:unit`'s own exit code turned non-zero, whether from a failed
 * assertion or from the mutant crashing the runner outright — both are
 * the suite noticing. A survivor is everything else.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const APP_DIR = path.resolve(__dirname, "..");
const APP_PREFIX = "apps/voyager/";

const EXCLUDED: RegExp[] = [
  /\.test\.tsx?$/,
  /\.fixture\.tsx?$/,
  /^scripts\/check-/,
  /^e2e\//,
];

function isEligible(relPath: string): boolean {
  if (!/\.tsx?$/.test(relPath)) return false;
  return !EXCLUDED.some((re) => re.test(relPath));
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: APP_DIR, encoding: "utf8" });
}

function changedFiles(base: string): string[] {
  const mergeBase = git(["merge-base", base, "HEAD"]).trim();
  const names = git(["log", `${mergeBase}..HEAD`, "--name-only", "--pretty=format:"]);
  return names
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(APP_PREFIX))
    .map((line) => line.slice(APP_PREFIX.length));
}

const argv = process.argv.slice(2);
const baseFlagIndex = argv.indexOf("--base");
const base = baseFlagIndex >= 0 ? argv[baseFlagIndex + 1] : "integracion";
const explicitFiles = argv.filter((arg, i) => arg !== "--base" && argv[i - 1] !== "--base");

const candidateFiles = explicitFiles.length > 0 ? explicitFiles : changedFiles(base);
const targetFiles = candidateFiles.filter(isEligible).filter((f) => existsSync(path.join(APP_DIR, f)));

console.log(
  explicitFiles.length > 0
    ? `Named directly: ${targetFiles.length} of ${candidateFiles.length} file(s) eligible.`
    : `Changed against ${base}: ${targetFiles.length} of ${candidateFiles.length} file(s) eligible.`,
);

type Mutation = {
  mutator: string;
  line: number; // 1-based
  before: string;
  after: string;
  content: string; // the whole mutated file
};

// Every non-overlapping match of `pattern` on one line becomes its own
// mutant: two candidates on one line are two mutations, not one.
function tokenMutations(
  lines: string[],
  pattern: RegExp,
  replace: (match: RegExpExecArray) => string,
  mutator: string,
): Mutation[] {
  const out: Mutation[] = [];
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const re = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(line))) {
      const replacement = replace(match);
      if (replacement !== match[0]) {
        const after = line.slice(0, match.index) + replacement + line.slice(match.index + match[0].length);
        out.push({ mutator, line: i + 1, before: line, after, content: withLine(lines, i, after) });
      }
    }
  }
  return out;
}

function withLine(lines: string[], index: number, replacement: string): string {
  const next = [...lines];
  next[index] = replacement;
  return next.join("\n");
}

function flipComparison(lines: string[]): Mutation[] {
  return tokenMutations(
    lines,
    /(?<=\s)(>=|>)(?=\s)/,
    (m) => (m[0] === ">=" ? ">" : ">="),
    "flip > <-> >=",
  );
}

function flipEquality(lines: string[]): Mutation[] {
  return tokenMutations(
    lines,
    /(?<=\s)(===|!==)(?=\s)/,
    (m) => (m[0] === "===" ? "!==" : "==="),
    "flip === <-> !==",
  );
}

function andToOr(lines: string[]): Mutation[] {
  return tokenMutations(lines, /(?<=\s)&&(?=\s)/, () => "||", "&& -> ||");
}

function removeAwait(lines: string[]): Mutation[] {
  return tokenMutations(lines, /\bawait\s+/, () => "", "remove await");
}

function shiftIndex(lines: string[]): Mutation[] {
  const bracket = tokenMutations(
    lines,
    /\[(\d+)\]/,
    (m) => `[${Number(m[1]) + 1}]`,
    "shift a bracket index by one",
  );
  const sliceLike = tokenMutations(
    lines,
    /\.(slice|charAt|charCodeAt)\((\d+)/,
    (m) => `.${m[1]}(${Number(m[2]) + 1}`,
    "shift a slice/charAt argument by one",
  );
  return [...bracket, ...sliceLike];
}

// Both read off the same shape — a single-line `if (cond) return expr;`
// guard — so one scan finds every site both mutators need.
function guardMutations(lines: string[]): Mutation[] {
  const out: Mutation[] = [];
  const guard = /^(\s*)if \((.+)\) return (.+);$/;
  for (let i = 0; i < lines.length; i++) {
    const match = guard.exec(lines[i]);
    if (!match) continue;
    const [, indent, cond, expr] = match;
    const removed = `${indent}// (guard removed by mutation testing)`;
    out.push({ mutator: "delete a guard", line: i + 1, before: lines[i], after: removed, content: withLine(lines, i, removed) });
    const inverted = `${indent}if (!(${cond})) return ${expr};`;
    out.push({ mutator: "invert an early return", line: i + 1, before: lines[i], after: inverted, content: withLine(lines, i, inverted) });
  }
  return out;
}

// A plain `return <expr>;` — never the `if (...) return` guard shape above,
// never a line whose expression is already one of the three sentinels —
// tried as each sentinel, one mutant per sentinel per site.
function returnSentinel(lines: string[]): Mutation[] {
  const out: Mutation[] = [];
  const plain = /^(\s*)return (.+);$/;
  const guardShape = /^\s*if \(.+\) return .+;$/;
  const alreadySentinel = /^(null|undefined|0|\[\]|true|false)$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (guardShape.test(line)) continue;
    const match = plain.exec(line);
    if (!match) continue;
    const [, indent, expr] = match;
    if (alreadySentinel.test(expr.trim())) continue;
    for (const sentinel of ["null", "0", "[]"]) {
      const after = `${indent}return ${sentinel};`;
      out.push({ mutator: `return ${sentinel} regardless`, line: i + 1, before: line, after, content: withLine(lines, i, after) });
    }
  }
  return out;
}

const MUTATORS = [flipComparison, flipEquality, andToOr, removeAwait, shiftIndex, guardMutations, returnSentinel];

function checkUnit(): boolean {
  const result = spawnSync(
    process.execPath,
    ["--experimental-test-module-mocks", "--import", "tsx", "--test", "lib/**/*.test.ts"],
    { cwd: APP_DIR, encoding: "utf8" },
  );
  return result.status === 0;
}

type Survivor = { file: string; line: number; mutator: string; before: string; after: string };

const survivors: Survivor[] = [];
let killed = 0;
const touched = new Set<string>();

try {
  for (const file of targetFiles) {
    const absolute = path.join(APP_DIR, file);
    const original = readFileSync(absolute, "utf8");
    const lines = original.split("\n");
    const mutations = MUTATORS.flatMap((mutator) => mutator(lines));
    console.log(`${file}: ${mutations.length} mutant(s)`);

    for (const mutation of mutations) {
      touched.add(file);
      writeFileSync(absolute, mutation.content);
      const noticed = !checkUnit();
      execFileSync("git", ["checkout", "--", file], { cwd: APP_DIR });
      if (noticed) {
        killed += 1;
      } else {
        survivors.push({ file, line: mutation.line, mutator: mutation.mutator, before: mutation.before, after: mutation.after });
      }
      console.log(
        `  ${noticed ? "killed  " : "SURVIVOR"}  ${file}:${mutation.line}  [${mutation.mutator}]`,
      );
    }
  }
} finally {
  for (const file of touched) {
    execFileSync("git", ["checkout", "--", file], { cwd: APP_DIR });
  }
  if (touched.size > 0) {
    const status = git(["status", "--short", "--", ...touched]).trim();
    if (status.length > 0) {
      console.log("FAIL  the tree is not clean after restoring every mutated file:");
      console.log(status);
      process.exit(1);
    }
  }
}

console.log("");
console.log(`REPORT  ${killed} killed, ${survivors.length} survivor(s), ${killed + survivors.length} total`);
if (survivors.length > 0) {
  console.log("");
  console.log("file:line  mutator  before -> after");
  for (const s of survivors) {
    console.log(`${s.file}:${s.line}  [${s.mutator}]`);
    console.log(`  - ${s.before.trim()}`);
    console.log(`  + ${s.after.trim()}`);
  }
}
process.exit(survivors.length > 0 ? 1 : 0);
