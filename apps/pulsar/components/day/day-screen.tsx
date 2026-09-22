import { getTranslations } from "next-intl/server";

import { Page, SectionLabel } from "@/components/ui";
import { loadDay } from "@/lib/queries/day";
import { todayInZone } from "@/lib/zone";

import { DayHeader } from "./day-header";
import { DayRow } from "./day-row";
import { EmptyDay } from "./empty-day";
import { EvidenceNote } from "./evidence-note";

/**
 * Opens the app on today (RP-01): no tap, no choice, no screen before it —
 * `app/page.tsx` is the redirect gate and nothing else, this is the whole
 * screen.
 *
 * `DayView`'s slots (`lib/day/types.ts`) carry a bare `commitmentId`, with
 * no commitment name and no goal id, and `loadDay` does not return the
 * day's goals or one-offs. This screen draws every slot in one flat list —
 * not one section per goal — named `day.commitmentFallback` for anything
 * not satisfied by evidence; evidence still carries its source's real name
 * (RP-09). One-offs are not drawn. Closing this is a change to
 * `lib/queries/day.ts`, out of this module's own file list; see its report.
 */
export async function DayScreen() {
  const t = await getTranslations();
  const day = todayInZone();
  const { view, evidence } = await loadDay(day);

  return (
    <Page>
      <DayHeader
        title={t("day.title")}
        toLightLabel={t("day.theme.toLight")}
        toDarkLabel={t("day.theme.toDark")}
      />

      {evidence === "unreadable" ? <EvidenceNote text={t("day.unreadableEvidence")} /> : null}

      {view.slots.length === 0 ? (
        <EmptyDay title={t("day.empty.title")} action={t("day.empty.action")} />
      ) : (
        <>
          {view.phase ? <SectionLabel>{view.phase.name}</SectionLabel> : null}
          {view.slots.map((slot, index) => (
            <DayRow
              key={slot.commitmentId}
              commitmentId={slot.commitmentId}
              name={slot.labelKey ? t(slot.labelKey) : t("day.commitmentFallback", { n: index + 1 })}
              markState={slot.satisfiedBy === "evidence" ? "evidence" : slot.satisfied ? "declared" : "empty"}
              tappable={slot.satisfiedBy !== "evidence"}
            />
          ))}
        </>
      )}
    </Page>
  );
}
