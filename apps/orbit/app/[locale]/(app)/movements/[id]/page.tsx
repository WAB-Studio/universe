import { hasLocale } from "next-intl";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { MovementDetail } from "@/components/transactions/movement-detail";
import { Page } from "@/components/ui";
import {
  getTransactionFormOptions,
  resolveCreatorNames,
} from "@/db/queries/transaction-form";
import { getTransactionById, listTransactions } from "@/db/queries/transactions";
import { routing } from "@/i18n/routing";

export async function generateMetadata(
  props: PageProps<"/[locale]/movements/[id]">,
): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const t = await getTranslations({ locale, namespace: "transactions" });

  return { title: t("detailTitle") };
}

export default async function MovementPage(
  props: PageProps<"/[locale]/movements/[id]">,
) {
  const { locale, id } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  // The read is scoped by RLS, so a movement the caller may not see returns null;
  // the form options ride the same fan-out for the edit dialog and the
  // account/category names the detail reads. The charges this movement caused
  // need no cause id to look up, so they ride this same round trip too (RF-132).
  const [movement, options, causedCharges] = await Promise.all([
    getTransactionById(id),
    getTransactionFormOptions(),
    listTransactions({ causedByTransactionId: id }),
  ]);

  if (!movement) notFound();

  // Both reads below need the movement, so neither could join the fan-out
  // above; they still run together rather than one after the other.
  const [creatorNames, cause] = await Promise.all([
    // The creator's id names the row; the map turns it into a member's name (an
    // archived member included) or, only for the caller's own id, their email.
    resolveCreatorNames([movement.createdBy]),
    movement.causedByTransactionId
      ? getTransactionById(movement.causedByTransactionId)
      : Promise.resolve(null),
  ]);

  return (
    // The desktop detail carries the gutter itself, band by band (SPEC-A3).
    <Page gutter="flush-md">
      <MovementDetail
        movement={movement}
        options={options}
        creatorName={creatorNames.get(movement.createdBy) ?? null}
        cause={cause}
        causedCharges={causedCharges}
      />
    </Page>
  );
}
