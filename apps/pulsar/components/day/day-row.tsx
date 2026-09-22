"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { declareFact } from "@/app/actions/facts";
import { Mark, Row, Text, type MarkState } from "@/components/ui";

export type DayRowProps = {
  commitmentId: string;
  name: string;
  markState: MarkState;
  // False only for a commitment evidence has already satisfied (RP-05,
  // RP-09): nothing else in `DayView`'s own shape tells a tap-commitment
  // from an evidence one that has not been satisfied yet — see the note on
  // `handleTap` below for what that costs and how it is covered.
  tappable: boolean;
};

/**
 * One commitment's row (RP-01, RP-02). `declareFact` is called with the
 * commitment id alone, never a quantity: `DayView`'s own slot carries no
 * mechanism kind for an unsatisfied commitment, so this row cannot tell a
 * `tap` commitment from a `quantity` one before the server does. A `tap`
 * commitment is satisfied outright; a `quantity` one comes back refused with
 * `day.errors.quantityRequired`, and an evidence one still asking comes back
 * `day.errors.evidenceOnly` — both named, both shown, neither a crash. The
 * quantity sheet (module 14) is what actually offers a number; until it
 * lands, a `quantity` row's tap is wired to this same gesture and reports
 * why it did not take, rather than inventing the sheet.
 */
export function DayRow({ commitmentId, name, markState, tappable }: DayRowProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleTap() {
    if (!tappable || pending) return;
    setError(null);

    startTransition(() => {
      void declareFact({ commitmentId }).then((result) => {
        if (!result.ok) setError(result.error);
      });
    });
  }

  return (
    <>
      <Row
        leading={<Mark state={markState} />}
        name={name}
        onClick={handleTap}
        disabled={!tappable || pending}
      />
      {error ? (
        <Text as="p" tone="muted" variant="meta">
          {t(error)}
        </Text>
      ) : null}
    </>
  );
}
