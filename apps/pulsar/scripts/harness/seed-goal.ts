// Gives the identity `mint-session.ts` minted a plan to drive: one goal,
// three phases, six commitments and one one-off, all through the same
// actions a person's own screen would call (`app/actions/plan.ts`,
// `app/actions/one-offs.ts`) — never a raw INSERT, and never a privileged
// connection. Until module 16's goal screen exists, this is the only writer
// of a goal at all, so what it seeds is written to read like a person's own
// plan, not a placeholder.
//
// Every action in this app is `"use server"`, which the Next compiler reads
// at build time and a plain script never sees — imported directly, these run
// as the ordinary async functions they are. What they cannot survive outside
// Next is what they import: `server-only` does not exist as a package at all
// off Next's bundler (`apps/orbit/scripts/harness/stubs/server-only.ts`'s own
// comment), `next/headers`'s `cookies()` throws outside a request scope, and
// `next/cache`'s `revalidatePath` throws with no static generation store to
// invalidate. `apps/orbit/scripts/check-queries.ts` solves the first with a
// `TSX_TSCONFIG_PATH` pointed at a stub file; this script has no second file
// to point one at, so the same three modules are stubbed in-process instead,
// by replacing `Module._load` before the first `@/`-rooted import ever runs.
// tsx compiles this project's TypeScript to CommonJS (no `"type": "module"`
// in `package.json`), so every `require` — including the ones tsx generates
// for a dynamically `import()`-ed `.ts` file's own `import` statements —
// still funnels through this one function.
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function laneNumber(): number {
  const raw = process.env.HARNESS_LANE?.trim();
  if (!raw) return 1;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`HARNESS_LANE must be a positive integer, not "${raw}"`);
  }
  return Number(raw);
}

const lane = laneNumber();

function sessionFile(): string {
  return resolve(process.cwd(), `private/session-${lane}.json`);
}

type StoredCookie = { name: string; value: string };

function loadCookies(): StoredCookie[] {
  const file = sessionFile();
  let state: { cookies: StoredCookie[] };
  try {
    state = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`no session at ${file} — run mint-session.ts first`);
  }
  if (state.cookies.length === 0) {
    throw new Error(`${file} carries no cookie — the mint did not land one`);
  }
  return state.cookies.map(({ name, value }) => ({ name, value }));
}

// Real cookies from a real `/auth/confirm` redemption: `@supabase/ssr`'s own
// client parses them and asks the real auth server for real claims, so
// `getPerson()` below sees exactly the identity `mint-session.ts` minted —
// nothing here fabricates a claim the way `apps/orbit/scripts/harness/
// stubs/supabase-server.ts` does.
function installStubs(cookies: StoredCookie[]): void {
  // `_load` is undocumented — the type declarations carry no signature for
  // it — but it is the one interception point every `require`, including
  // tsx's own generated ones, actually calls.
  const untyped = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = untyped._load;
  untyped._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    if (request === "next/headers") {
      return { cookies: async () => ({ getAll: () => cookies, set() {} }) };
    }
    if (request === "next/cache") {
      return { revalidatePath() {} };
    }
    return originalLoad(request, parent, isMain);
  };
}

// Whole civil days added to a `YYYY-MM-DD` string, by midday UTC — the same
// technique `lib/zone.ts`'s own `weekOf` uses, so a phase boundary never
// drifts a day the way a naive `Date` constructor would.
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(date);
}

async function main(): Promise<void> {
  installStubs(loadCookies());

  const { todayInZone } = await import("@/lib/zone");
  const { createGoal, addPhase, addCommitment } = await import("@/app/actions/plan");
  const { createOneOff } = await import("@/app/actions/one-offs");
  const { getPerson } = await import("@/lib/session");

  const person = await getPerson();
  if (!person) throw new Error("no settled session — mint-session.ts's cookie did not verify");
  console.log(`seeding as ${person.email} (${person.id})`);

  // Three four-week phases (`plan-ingles-dev.md`'s own "## Fases"), back to
  // back from today — the horizon a person opening the app today would set.
  const today = todayInZone();
  const phase1Start = today;
  const phase1End = addDays(phase1Start, 27);
  const phase2Start = addDays(phase1End, 1);
  const phase2End = addDays(phase2Start, 27);
  const phase3Start = addDays(phase2End, 1);
  const phase3End = addDays(phase3Start, 27);

  const goal = await createGoal({
    name: "Inglés B1/B2 → B2+ laboral",
    horizon: phase3End,
  });
  if (!goal.ok) throw new Error(`createGoal: ${goal.error}`);
  console.log(`goal ${goal.goalId}`);

  const phases = [
    {
      aim: "Desbloquear la boca: perder el miedo a hablar y pasar de 2 a 4 minutos de monólogo sin congelarse.",
      startsOn: phase1Start,
      endsOn: phase1End,
    },
    {
      aim: "Precisión: corregir los 3-4 errores que se repiten siempre y subir a 2 conversaciones humanas por semana.",
      startsOn: phase2Start,
      endsOn: phase2End,
    },
    {
      aim: "Contexto laboral: convertir el monólogo en respuestas STAR, preparar 6-8 historias y aplicar a vacantes.",
      startsOn: phase3Start,
      endsOn: phase3End,
    },
  ];
  for (const phase of phases) {
    const result = await addPhase({ goalId: goal.goalId, ...phase });
    if (!result.ok) throw new Error(`addPhase(${phase.aim}): ${result.error}`);
    console.log(`phase ${result.phaseId} — ${phase.aim}`);
  }

  // "Bloque fijo diario" — `plan-ingles-dev.md`'s four daily items. Anki is
  // added first, so it is the quantity commitment the goal takes its own
  // measure from (§0.3, 3): `addCommitment` names `goals.measure_name` /
  // `measure_unit` after whichever quantity commitment lands first, and never
  // again once that column is no longer null.
  const commitments: Parameters<typeof addCommitment>[0][] = [
    {
      goalId: goal.goalId,
      name: "Anki",
      cadenceKind: "daily",
      satisfaction: "quantity",
      targetQuantity: 10,
      unit: "minutos",
    },
    {
      goalId: goal.goalId,
      name: "Shadowing",
      cadenceKind: "daily",
      satisfaction: "quantity",
      targetQuantity: 15,
      unit: "minutos",
    },
    {
      goalId: goal.goalId,
      name: "Monólogo grabado",
      cadenceKind: "daily",
      satisfaction: "quantity",
      targetQuantity: 10,
      unit: "minutos",
    },
    {
      goalId: goal.goalId,
      name: "Cerrar el ciclo: tarjetas de los errores",
      cadenceKind: "daily",
      satisfaction: "tap",
    },
    // "Bloque variable por día" — distinct content Monday to Friday, one
    // weekend session apart (out of this seed): one weekday commitment,
    // never seven daily ones.
    {
      goalId: goal.goalId,
      name: "Bloque variable del día",
      cadenceKind: "weekdays",
      cadenceWeekdays: [1, 2, 3, 4, 5],
      satisfaction: "tap",
    },
    // The evidence path (RP-07): satisfied by `reading.lookups` rows read
    // through voyager's own policy, one lookup a day clears it.
    {
      goalId: goal.goalId,
      name: "Buscar palabras nuevas mientras leo",
      cadenceKind: "daily",
      satisfaction: "evidence",
      sourceKey: "reading_lookups",
      threshold: 1,
    },
  ];
  for (const commitment of commitments) {
    const result = await addCommitment(commitment);
    if (!result.ok) throw new Error(`addCommitment(${commitment.name}): ${result.error}`);
    console.log(`commitment ${result.commitmentId} — ${commitment.name}`);
  }

  // "Grabar el audio de referencia (semana 1)" — the one genuinely one-time
  // errand in the whole plan, scheduled for today.
  const oneOff = await createOneOff({
    goalId: goal.goalId,
    name: "Grabar el audio de referencia (semana 1)",
    day: today,
  });
  if (!oneOff.ok) throw new Error(`createOneOff: ${oneOff.error}`);
  console.log(`one-off ${oneOff.oneOffId}`);
}

void (async () => {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.error(`FAILED  ${(error as Error).message}`);
    process.exit(1);
  }
})();
