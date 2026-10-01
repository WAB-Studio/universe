import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button, Face, Figure, Flex, Page, Panel, SectionLabel, Split, Text } from "@/components/ui";
import { dayPhrase as dayPhraseOf, endedPhrase } from "@/lib/day/day-phrase";
import { metPhrase, phaseLine } from "@/lib/day/row-phrases";
import { tallyDay } from "@/lib/day/tally";
import { isTimeUnit } from "@/lib/units/time";
import { phaseOn } from "@/lib/day/derive";
import type { DaySlot } from "@/lib/day/types";
import { loadDay, type CommitmentInfo, type OneOffSummary } from "@/lib/queries/day";
import { PAST_DAY_LIMIT } from "@/lib/validation/fact";
import { civilDateToDate, dateToCivilDate, timeInZone, todayInZone } from "@/lib/zone";

import { DayHeader } from "./day-header";
import { DayRow } from "./day-row";
import { EmptyDay } from "./empty-day";
import { DoneOneOffRow } from "./done-one-off-row";
import { EvidenceNote } from "./evidence-note";
import { NewOneOff } from "./new-one-off";
import { OneOffRow } from "./one-off-row";

type Translate = Awaited<ReturnType<typeof getTranslations>>;

// Goes through `Date` and back rather than subtracting on the string: a
// civil date crosses months and years, and a digit subtraction does not.
export function shiftCivilDay(day: string, days: number): string {
  const date = civilDateToDate(day);
  date.setUTCDate(date.getUTCDate() + days);
  return dateToCivilDate(date);
}

// The oldest day a fact may still name (RP-06): `/dia/[fecha]` refuses any
// day before it, and its own screen draws no step back from it.
export function oldestPastDay(today: string): string {
  return shiftCivilDay(today, -PAST_DAY_LIMIT);
}

// Monday first, as `day.weekdayLong` lists them; `getUTCDay` is 0 for Sunday.
function weekdayOf(day: string, t: Translate): string {
  const names = t.raw("day.weekdayLong") as string[];
  return names[(civilDateToDate(day).getUTCDay() + 6) % 7];
}

// «sábado 26 de septiembre»: the header's own date.
function dateLabel(day: string, t: Translate): string {
  const date = civilDateToDate(day);
  const months = t.raw("day.monthLong") as string[];
  return t("day.date", {
    weekday: weekdayOf(day, t),
    day: date.getUTCDate(),
    month: months[date.getUTCMonth()],
  });
}

function dayPhrase(key: string, day: string, t: Translate, extra: Record<string, string> = {}): string {
  return dayPhraseOf(
    (phraseKey, values) => t(phraseKey, values),
    key,
    day,
    todayInZone(),
    { weekdays: t.raw("day.weekdayLong") as string[], months: t.raw("day.monthLong") as string[] },
    extra,
  );
}

/**
 * Opens the app on today (RP-01): no tap, no choice, no screen before it —
 * `app/page.tsx` is the redirect gate and nothing else, this is the whole
 * screen.
 *
 * Every open goal draws as its own group, in one scroll, with no selector
 * (§0.3, 5): `loadDay`'s `commitments` names which goal each slot belongs
 * to, and `phases` — narrowed to that goal — decides the phase in effect
 * through `phaseOn`, module 4's own function, called once per goal rather
 * than reading `view.phase`, which picks a single span across every goal at
 * once and is only ever right for one of them.
 *
 * A one-off draws under the goal it belongs to (RP-19, RP-20): its own row
 * inside that goal's section, with that goal's own field to write another
 * one the same way. A one-off that belongs to nothing draws in its own
 * "Sueltas" group below the last goal, with the field that writes one of
 * those — permanently visible either way, never behind a control that
 * reveals it (`one-off-row.tsx`, `new-one-off.tsx`). A one-off undone since
 * an earlier day rides first, naming the day it was meant for.
 *
 * Given a `day` before today (RP-06, `/dia/[fecha]`), the same rows draw
 * for that day and every fact they write names it. No one-off draws there:
 * an undone one already rides today, and a one-off is done the day it is
 * done (`requireDayForSubject`).
 */
export async function DayScreen({ day: requested }: { day?: string } = {}) {
  const t = await getTranslations();
  const today = todayInZone();
  const day = requested ?? today;
  const past = day < today;
  const loaded = await loadDay(day);
  const {
    view,
    evidence,
    goals: openGoals,
    oneOffs,
    doneOneOffs,
    daylessCount,
    scheduledCount,
    weekMeasure,
    commitments,
    phases,
    phasePositions,
    factsByCommitment,
    periodDone,
  } = loaded;

  // A goal opened after the day drawn did not exist on it: it is not drawn
  // there at all (RNP-07).
  const goals = openGoals.filter((goal) => goal.openedOn <= day);
  const laterGoal = past
    ? openGoals.filter((goal) => goal.openedOn > day).sort((a, b) => a.openedOn.localeCompare(b.openedOn))[0]
    : undefined;

  // Every goal ended and none open (`HoyTodasTerminadas.dc.html`).
  const lastEnded = !past && openGoals.length === 0 ? loaded.lastEnded : null;

  // Only today, and only while some goal is open: the all-ended card already
  // names the last one (`HoyMetaTerminada.dc.html`).
  const endedLines =
    past || openGoals.length === 0
      ? []
      : loaded.endedThisWeek.map((goal) => ({
          id: goal.id,
          text: endedPhrase(
            (key, values) => t(key, values),
            goal.name,
            goal.lastDay,
            todayInZone(),
            { weekdays: t.raw("day.weekdayLong") as string[], months: t.raw("day.monthLong") as string[] },
          ),
          href: `/metas/${goal.id}`,
          see: t("day.ended.see"),
          seeLabel: t("day.ended.seeLabel", { goal: goal.name }),
        }));

  const waiting = daylessCount + scheduledCount;

  // The same count the Semana's cell for this day makes; nothing to say when
  // it counts nothing or when the all-ended card stands in for the goals.
  const counted = tallyDay({
    view,
    goals: openGoals,
    commitments,
    oneOffFacts: doneOneOffs.map((oneOff) => ({ day, goalId: oneOff.goalId })),
  });
  const tally =
    goals.length === 0 || lastEnded || counted.total === 0
      ? undefined
      : t("day.tally", { done: counted.done, total: counted.total });
  const slotByCommitmentId = new Map(view.slots.map((slot) => [slot.commitmentId, slot]));

  // Stable: within each kind, `loadDay`'s own creation order stands.
  const carriedFirst = [...oneOffs].sort(
    (a, b) => Number(!isCarried(a, day)) - Number(!isCarried(b, day)),
  );

  function oneOffRow(oneOff: OneOffSummary) {
    return (
      <OneOffRow
        key={oneOff.id}
        oneOffId={oneOff.id}
        name={oneOff.name}
        carriedFrom={
          isCarried(oneOff, day)
            ? dayPhrase("day.oneOffs.carriedFrom", oneOff.day, t)
            : undefined
        }
      />
    );
  }

  const goalsMain = goals.length === 0 && past ? (
    <>
      <Text as="p" variant="title">
        {t("day.past.nothingTitle")}
      </Text>
      {laterGoal ? (
        <Text as="p" variant="meta" tone="muted">
          {dayPhrase("day.past.startedOn", laterGoal.openedOn, t, { goal: laterGoal.name })}
        </Text>
      ) : null}
    </>
  ) : lastEnded ? (
    <Panel as="div">
      {oneOffs.length === 0 ? (
        <Text as="p" variant="title" plainWide>
          {t("day.allEnded.title")}
        </Text>
      ) : null}
      <Text as="p">
        {t("day.allEnded.body", {
          goal: lastEnded.name,
          date: dateLabel(shiftCivilDay(lastEnded.horizon, -1), t),
        })}
      </Text>
      <Button asChild block>
        <Link href="/metas">{t("day.allEnded.toGoals")}</Link>
      </Button>
      <Button asChild block variant="outline">
        <Link href="/metas/nueva">{t("day.allEnded.newGoal")}</Link>
      </Button>
    </Panel>
  ) : goals.length === 0 ? (
    <EmptyDay title={t("day.empty.title")} action={t("day.empty.action")} />
  ) : (
    <>
      {goals.map((goal) => {
        const goalPhases = phases.filter((phase) => phase.goalId === goal.id);
        const goalPhase = phaseOn(goalPhases, day);
        const own = commitments
          .filter((commitment) => commitment.goalId === goal.id)
          .map((commitment) => ({ commitment, slot: slotByCommitmentId.get(commitment.id) }));
        // A commitment that does not ask on `day` has no slot at all
        // (`deriveDay`'s own contract): one still owed draws nothing, one
        // already met in its period draws quiet after the asked rows.
        const rows = own.filter(
          (entry): entry is { commitment: CommitmentInfo; slot: DaySlot } => entry.slot !== undefined,
        );
        const met = own
          .filter(
            (entry) =>
              entry.slot === undefined &&
              metPhrase((key, values) => t(key, values), {
                cadence: entry.commitment.cadence,
                periodDone: periodDone[entry.commitment.id],
              }) !== null,
          )
          .map((entry) => entry.commitment);

        return (
          <Panel as="div" key={goal.id}>
            <section>
              <SectionLabel>{goal.name}</SectionLabel>
              {goalPhase ? (
                <Text as="p" tone="muted" variant="meta">
                  {phaseLine((key, values) => t(key, values), goalPhase.name, phasePositions[goalPhase.id])}
                </Text>
              ) : null}
              {rows.map(({ commitment, slot }) => {
                const logged = factsByCommitment[commitment.id];
                return (
                  <DayRow
                    key={commitment.id}
                    commitmentId={commitment.id}
                    name={commitment.name}
                    kind={commitment.kind}
                    markState={slot.satisfiedBy === "evidence" ? "evidence" : slot.satisfied ? "declared" : "empty"}
                    sourceName={
                      slot.satisfiedBy === "evidence" && slot.labelKey ? t(slot.labelKey) : undefined
                    }
                    target={commitment.target}
                    unit={commitment.unit}
                    cadence={commitment.cadence}
                    periodDone={periodDone[commitment.id]}
                    factId={logged?.factId}
                    loggedQuantity={logged?.quantity ?? null}
                    note={logged?.note ?? null}
                    day={past ? day : undefined}
                    writtenLabel={
                      logged && logged.writtenOn !== day
                        ? dayPhrase("day.past.writtenOn", logged.writtenOn, t)
                        : undefined
                    }
                    writtenTime={
                      logged && slot.satisfiedBy !== "evidence" && (slot.satisfied || commitment.kind === "quantity")
                        ? timeInZone(logged.writtenAt)
                        : undefined
                    }
                  />
                );
              })}
              {met.map((commitment) => {
                const logged = factsByCommitment[commitment.id];
                return (
                  <DayRow
                    key={commitment.id}
                    commitmentId={commitment.id}
                    name={commitment.name}
                    kind={commitment.kind}
                    markState="declared"
                    quiet
                    target={commitment.target}
                    unit={commitment.unit}
                    cadence={commitment.cadence}
                    periodDone={periodDone[commitment.id]}
                    factId={logged?.factId}
                    loggedQuantity={logged?.quantity ?? null}
                    note={logged?.note ?? null}
                    day={past ? day : undefined}
                  />
                );
              })}
              {past ? null : (
                <>
                  {carriedFirst.filter((oneOff) => oneOff.goalId === goal.id).map(oneOffRow)}
                  <NewOneOff goalId={goal.id} daylessCount={daylessCount} goalName={goal.name} />
                </>
              )}
            </section>
          </Panel>
        );
      })}
    </>
  );

  // One card per open goal that has a measure; a goal without one draws none.
  const figures = goals.filter((goal) => goal.measureName !== null && weekMeasure[goal.id] !== undefined);

  // Drawn inside `goalless`, so only on today (RP-28), never on a past day.
  // A goal with no amount this month draws nothing.
  const monthGoals = goals.filter(
    (goal) => goal.measureUnit !== null && loaded.monthLine[goal.id]?.planned != null,
  );

  // The same two lines on the phone block and in the desktop card: reached
  // «de» planned, and from the 20th the pace in ink, never an alarm.
  const monthLines = (goal: (typeof goals)[number]) => {
    const line = loaded.monthLine[goal.id];
    const planned = line.planned as number;
    return (
      <>
        <Flex align="baseline" gap="2" wrap="wrap">
          <Figure value={line.reached} unit={goal.measureUnit ?? undefined} variant="meta" />
          <Text variant="meta" tone="muted">
            {t("day.monthLine.of")} <Figure value={planned} unit={goal.measureUnit ?? undefined} variant="meta" />
          </Text>
        </Flex>
        {line.underPace ? (
          <Text as="p" variant="meta">
            {t("day.monthLine.pace", {
              day: Number(day.slice(8, 10)),
              percent: Math.floor((line.reached * 100) / planned),
              threshold: 60,
            })}
          </Text>
        ) : null}
      </>
    );
  };

  // A one-off belonging to nothing (RP-20) has no goal section to draw
  // under, so it gets a group of its own — always on screen, even with
  // no goal open yet, because RP-19 asks for no goal behind it either.
  const goalless = past ? undefined : (
    <>
      {figures.map((goal) => (
        <Panel as="div" key={goal.id}>
          <Face on="desktop">
            <SectionLabel>{isTimeUnit(goal.measureUnit) ? goal.name : goal.measureUnit}</SectionLabel>
            <Flex align="baseline" gap="2">
              <Figure value={weekMeasure[goal.id]} unit={isTimeUnit(goal.measureUnit) ? goal.measureUnit ?? undefined : undefined} />
              <Text variant="meta" tone="muted">
                {t("day.weekFigure.caption")}
              </Text>
            </Flex>
            {monthGoals.includes(goal) ? (
              <>
                <SectionLabel>{t("day.monthLine.title")}</SectionLabel>
                {monthLines(goal)}
              </>
            ) : null}
            <Button asChild tap={44} variant="ghost">
              <Link href={`/metas/${goal.id}/revision`}>
                <Text variant="meta" tone="accent">
                  {t("goal.detail.reviewLink")}
                </Text>
              </Link>
            </Button>
          </Face>
        </Panel>
      ))}
      {monthGoals.length > 0 ? (
        <Face on="phone">
          <Panel as="div">
            <section>
              <SectionLabel>{t("day.monthLine.title")}</SectionLabel>
              {monthGoals.map((goal) => (
                <div key={goal.id}>
                  <Text as="p" variant="name">
                    {goal.name}
                  </Text>
                  {monthLines(goal)}
                </div>
              ))}
            </section>
          </Panel>
        </Face>
      ) : null}
      <Panel as="div">
        <section>
          <Flex justify="between" align="center" gap="2" mb={{ initial: "0", lg: "1" }}>
            <SectionLabel>{t("day.oneOffs.title")}</SectionLabel>
            {waiting > 0 ? (
              <Button asChild tap={44} variant="ghost">
                <Link href="/sueltas">
                  <Text variant="meta" tone="accent">
                    {t("day.oneOffs.daylessLink", { count: waiting })}
                  </Text>
                </Link>
              </Button>
            ) : null}
          </Flex>
          {carriedFirst.filter((oneOff) => oneOff.goalId === null).map(oneOffRow)}
          <NewOneOff daylessCount={daylessCount} />
        </section>
      </Panel>
      {doneOneOffs.length > 0 ? (
        <Panel as="div">
          <section>
            <SectionLabel>{t("day.doneOneOffs.title")}</SectionLabel>
            {doneOneOffs.map((done) => (
              <DoneOneOffRow
                key={done.id}
                factId={done.factId}
                name={done.name}
                time={timeInZone(done.writtenAt)}
              />
            ))}
          </section>
        </Panel>
      ) : null}
    </>
  );

  return (
    <Page width={past ? undefined : "full"}>
      {past ? (
        <DayHeader
          date={dateLabel(day, t)}
          back={
            day > oldestPastDay(today)
              ? { href: `/dia/${shiftCivilDay(day, -1)}`, label: t("day.nav.dayBefore") }
              : undefined
          }
          limitNote={day > oldestPastDay(today) ? undefined : t("day.past.limit")}
          toToday={{ href: "/", label: t("day.nav.today") }}
          tally={tally}
        />
      ) : (
        <DayHeader
          date={dateLabel(day, t)}
          title={t("day.title")}
          back={{ href: `/dia/${shiftCivilDay(day, -1)}`, label: t("day.nav.yesterday") }}
          theme={{ toLightLabel: t("day.theme.toLight"), toDarkLabel: t("day.theme.toDark") }}
          tally={tally}
          ended={endedLines}
        />
      )}

      {evidence === "unreadable" ? (
        <EvidenceNote text={past ? t("day.unreadableEvidencePast") : t("day.unreadableEvidence")} />
      ) : null}

      <Split main={goalsMain} after={goalless} />
    </Page>
  );
}

// A one-off meant for a day before the one drawn, still undone (RP-19):
// `loadDay` carries it with its own `day`, never clamped to today's.
function isCarried(oneOff: OneOffSummary, day: string): oneOff is OneOffSummary & { day: string } {
  return oneOff.day !== null && oneOff.day < day;
}
