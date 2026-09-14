"use client";

import { CheckIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { Fragment, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { markMovementReviewedAction } from "@/app/actions/recurring-rules";
import { deleteTransactionAction } from "@/app/actions/transactions";
import {
  MovementForm,
  movementFormDialogWidth,
} from "@/components/transactions/movement-form";
import {
  Badge,
  Button,
  CategoryTile,
  ConfirmDialog,
  Dialog,
  Flex,
  Money,
  Panel,
  PanelRow,
  ScreenHeader,
  Separator,
  Text,
  VisuallyHidden,
} from "@/components/ui";
import type { MoneyTone } from "@/components/ui";
import type { TransactionFormOptions } from "@/db/queries/transaction-form";
import type { TransactionListRow } from "@/db/queries/transactions";
import { useRouter } from "@/i18n/navigation";
import type { CurrencyCode } from "@/lib/currency";
import { civilDateToDate } from "@/lib/dates";
import { deriveRate } from "@/lib/money";
import { foreignSettlementCurrency } from "@/lib/validation/transaction";
import { useActionErrorToast } from "@/lib/use-action-toast";

// The side pane of the DetalleMovimiento artboard, beside a main pane that takes
// what is left.
const SIDE_PANE = "396px";

// A rate is read, not counted with: enough figures to recognise it, whichever
// way round the two currencies are.
const RATE_FORMAT = { maximumSignificantDigits: 6 } as const;

// The tracks a cause or a caused charge rides on, borrowed from the dashboard's
// own row into a movement's detail (`RecentMovements`): tile, title, date, amount.
const CAUSE_ROW_COLUMNS = "36px 1fr 110px 160px";

/**
 * The two panes of one movement: the amount over its category tile, the
 * description and the splits on the left; the account, the derived type, the
 * date, who recorded it, the labels, what caused it and what it caused, and the
 * two actions on the right (RF-24, RF-25, RF-69, RF-70, RF-132). It reads the
 * props the phone's detail already receives, so the wider shape costs no query
 * of its own, and it deletes through the same confirm the phone uses. Money
 * stays integer cents; the sign is `Money`'s.
 */
export function MovementDetailDesktop({
  movement,
  options,
  creatorName,
  cause = null,
  causedCharges = [],
}: {
  movement: TransactionListRow;
  options: TransactionFormOptions;
  creatorName: string | null;
  // The movement this one was caused by, already read by the caller; the edit
  // dialog's picker seeds from it too.
  cause?: TransactionListRow | null;
  // The charges this movement caused, newest first, as the caller ordered them.
  causedCharges?: TransactionListRow[];
}) {
  const t = useTranslations("transactions");
  const tKey = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const onActionError = useActionErrorToast();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const remove = useAction(deleteTransactionAction, {
    onSuccess: () => router.push("/movements"),
    onError: onActionError,
  });

  // Confirming stamps `reviewed_at`, dropping the movement from the count, banner
  // and badge (RF-31); the action's refresh re-reads this detail, so the
  // affordance then disappears on its own.
  const confirm = useAction(markMovementReviewedAction, {
    onSuccess: () => toast.success(t("confirmedToast")),
    onError: onActionError,
  });

  const isUnreviewedGenerated =
    movement.recurringRuleId !== null && movement.reviewedAt === null;

  // A name and colour per account and per category id — children included — so
  // both panes read their names without a second lookup.
  const accountNames = new Map(options.accounts.map((a) => [a.id, a.name]));
  const categoryNames = new Map<string, string>();
  const categoryColors = new Map<string, string | null>();
  for (const category of options.categories) {
    categoryNames.set(category.id, category.name);
    categoryColors.set(category.id, category.color);
    for (const child of category.children) {
      categoryNames.set(child.id, child.name);
      categoryColors.set(child.id, child.color);
    }
  }

  const kind = movement.kind;
  const firstSplit = movement.splits[0]?.categoryId;

  const tone: MoneyTone =
    kind === "income" ? "income" : kind === "transfer" ? "transfer" : "expense";

  const kindLabel =
    kind === "income"
      ? t("kindIncome")
      : kind === "transfer"
        ? t("kindTransfer")
        : t("kindExpense");

  // A transfer names no category, so its tile stays the neutral surface (RF-69).
  const tileColor =
    kind === "transfer" ? null : (firstSplit && categoryColors.get(firstSplit)) ?? null;

  // A transfer reads "origin → destination"; an income names its destination, an
  // expense its source.
  const account =
    kind === "transfer"
      ? `${(movement.fromAccountId && accountNames.get(movement.fromAccountId)) ?? ""} → ${(movement.toAccountId && accountNames.get(movement.toAccountId)) ?? ""}`
      : kind === "income"
        ? (movement.toAccountId && accountNames.get(movement.toAccountId)) ?? ""
        : (movement.fromAccountId && accountNames.get(movement.fromAccountId)) ?? "";

  // The other side of a movement whose account settles elsewhere, and the rate
  // the two figures make between them (RF-122, RF-123).
  const foreign = foreignSettlementCurrency(movement.currency, {
    from: movement.fromSettlementCurrency,
    to: movement.toSettlementCurrency,
  });
  const counterAmountCents = foreign === null ? null : movement.counterAmountCents;
  const rate =
    counterAmountCents === null || foreign === null || movement.amountCents === 0
      ? null
      : deriveRate(
          movement.amountCents,
          movement.currency,
          counterAmountCents,
          foreign,
        );

  const occurredAt = civilDateToDate(movement.occurredAt);
  const longDate = format.dateTime(occurredAt, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const shortDate = format.dateTime(occurredAt, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // What the movement really cost: itself plus the charges it caused, and only
  // those in its own currency — a charge in another one is totalled on a line of
  // its own, since no figure sums two currencies (RF-124, RF-132).
  const combinedTotalCents =
    movement.amountCents +
    causedCharges.reduce(
      (sum, charge) =>
        charge.currency === movement.currency ? sum + charge.amountCents : sum,
      0,
    );

  const otherCurrencyTotals = new Map<CurrencyCode, number>();
  for (const charge of causedCharges) {
    if (charge.currency === movement.currency) continue;
    otherCurrencyTotals.set(
      charge.currency,
      (otherCurrencyTotals.get(charge.currency) ?? 0) + charge.amountCents,
    );
  }

  // A row's own words, off the maps this pane already built: what a person
  // wrote, the category the split names, or the kind.
  function causeRowTitle(row: TransactionListRow): string {
    if (row.description) return row.description;
    if (row.kind === "transfer") return t("kindTransfer");
    const first = row.splits[0]?.categoryId;
    return (
      (first && categoryNames.get(first)) ||
      (row.kind === "income" ? t("kindIncome") : t("kindExpense"))
    );
  }

  function causeRowTone(row: TransactionListRow): "income" | "transfer" | "expense" {
    if (row.kind === "income") return "income";
    if (row.kind === "transfer") return "transfer";
    return "expense";
  }

  function causeRowColor(row: TransactionListRow): string | null {
    const first = row.kind === "transfer" ? null : row.splits[0]?.categoryId;
    return (first && categoryColors.get(first)) ?? null;
  }

  function causeRowDate(row: TransactionListRow): string {
    return format.dateTime(civilDateToDate(row.occurredAt), {
      day: "numeric",
      month: "short",
    });
  }

  function causeRowCells(row: TransactionListRow) {
    return [
      { key: "tile", content: <CategoryTile color={causeRowColor(row)} size={36} /> },
      {
        key: "title",
        content: (
          <Text size="2" weight="medium" truncate>
            {causeRowTitle(row)}
          </Text>
        ),
      },
      {
        key: "date",
        numeric: true,
        content: (
          <Text as="div" size="2" color="gray">
            {causeRowDate(row)}
          </Text>
        ),
      },
      {
        key: "amount",
        align: "end" as const,
        content: (
          <Money minor={row.amountCents} currency={row.currency} tone={causeRowTone(row)} />
        ),
      },
    ];
  }

  return (
    <Flex direction="column">
      <ScreenHeader
        title={t("detailTitle")}
        meta={shortDate}
        back={{ href: "/movements", label: t("listTitle") }}
      />

      <Flex align="start" gap="4" px="6" pb="6">
        <Flex direction="column" gap="4" flexGrow="1" minWidth="0">
          <Panel>
            <Flex direction="column" align="center" gap="2" px="4" py="7">
              <CategoryTile color={tileColor} size={60} />
              <Money
                minor={movement.amountCents}
                currency={movement.currency}
                tone={tone}
                size="hero"
              />
              {/* The same movement in what the account settles in, marked as
                  what a statement has yet to confirm (RF-122, RF-123). Neither
                  figure ever stands for the other, and no total adds the two. */}
              {counterAmountCents !== null && foreign !== null && (
                <Money
                  minor={counterAmountCents}
                  currency={foreign}
                  signed={false}
                  estimate={movement.counterIsEstimate}
                  size="figure"
                />
              )}
              {movement.description && (
                <Text size="4" weight="medium" align="center">
                  {movement.description}
                </Text>
              )}
              <Flex align="center" gap="2">
                <Text size="2" weight="medium">
                  {kindLabel}
                </Text>
                <Text size="2" color="gray">
                  {t("kindDerivedFrom")}
                </Text>
              </Flex>
            </Flex>
          </Panel>

          {/* A transfer carries no split, so the block belongs to an income or an
              expense alone (RF-69). */}
          {movement.splits.length > 0 && (
            <Panel
              title={t("splitsTitle")}
              action={
                <Text size="2" color="gray">
                  {t.rich("splitsTotal", {
                    amount: () => (
                      <Money
                        minor={movement.amountCents}
                        currency={movement.currency}
                        signed={false}
                        size="inherit"
                      />
                    ),
                  })}
                </Text>
              }
            >
              {movement.splits.map((split, index) => (
                <Fragment key={split.categoryId}>
                  {index > 0 && <Separator size="4" />}
                  <Flex align="center" justify="between" gap="4" px="4" py="3">
                    <Flex align="center" gap="2" minWidth="0">
                      <CategoryTile
                        color={categoryColors.get(split.categoryId) ?? null}
                        size={9}
                      />
                      <Text size="2" color="gray" truncate>
                        {categoryNames.get(split.categoryId)}
                      </Text>
                    </Flex>
                    <Money
                      minor={split.amountCents}
                      currency={movement.currency}
                      signed={false}
                    />
                  </Flex>
                </Fragment>
              ))}
            </Panel>
          )}
        </Flex>

        <Flex direction="column" gap="4" width={SIDE_PANE} flexShrink="0">
          <Panel>
            <Flex direction="column" px="4" py="1">
              <Fact label={t("accountLabel")} value={account} />
              <Separator size="4" />
              <Fact label={t("typeLabel")} value={kindLabel} />
              {rate !== null && foreign !== null && (
                <>
                  <Separator size="4" />
                  {/* Derived, never stored: the quotient of the two figures
                      above it (RF-122). */}
                  <Fact
                    label={t("rateLabel")}
                    value={`1 ${movement.currency} = ${format.number(rate, RATE_FORMAT)} ${foreign}`}
                  />
                </>
              )}
              <Separator size="4" />
              <Fact label={t("dateLabel")} value={longDate} />
              {creatorName && (
                <>
                  <Separator size="4" />
                  <Fact label={t("createdBy")} value={creatorName} />
                </>
              )}
            </Flex>
          </Panel>

          {movement.labels.length > 0 && (
            <Panel title={t("labels")}>
              <Flex gap="2" wrap="wrap" px="4" pb="4">
                {movement.labels.map((label) => (
                  <Badge key={label.id} color="gray" variant="soft" radius="full">
                    {label.name}
                  </Badge>
                ))}
              </Flex>
            </Panel>
          )}

          {/* The movement that produced this one, one hop back and no further
              (RF-132): the row is the link. */}
          {cause && (
            <Panel title={t("causeLabel")}>
              <PanelRow
                href={`/movements/${cause.id}`}
                columns={CAUSE_ROW_COLUMNS}
                cells={causeRowCells(cause)}
              />
            </Panel>
          )}

          {/* What this movement cost beyond itself (RF-132), each charge with
              its own figure and the total the same currency makes with it. */}
          {causedCharges.length > 0 && (
            <Panel title={t("causedTitle")}>
              {causedCharges.map((charge) => (
                <PanelRow
                  key={charge.id}
                  href={`/movements/${charge.id}`}
                  columns={CAUSE_ROW_COLUMNS}
                  cells={causeRowCells(charge)}
                />
              ))}
              <Flex direction="column" px="4" py="1">
                <Separator size="4" />
                <Fact
                  label={t("causedTotal")}
                  value={
                    <Money minor={combinedTotalCents} currency={movement.currency} tone={tone} />
                  }
                />
                {[...otherCurrencyTotals].map(([code, cents]) => (
                  <Fragment key={code}>
                    <Separator size="4" />
                    <Fact
                      label={t("causedTotalOther", { currency: code })}
                      value={<Money minor={cents} currency={code} signed={false} />}
                    />
                  </Fragment>
                ))}
              </Flex>
            </Panel>
          )}

          {/* Only a generated movement still awaiting review offers Confirmar; a
              manual or already-reviewed one shows none. */}
          {isUnreviewedGenerated && (
            <Button
              type="button"
              size="3"
              disabled={confirm.isPending}
              onClick={() => confirm.execute({ transactionId: movement.id })}
            >
              <CheckIcon size={16} />
              {t("confirm")}
            </Button>
          )}

          <Flex gap="3">
            <Flex asChild align="center" justify="center" gap="2" flexGrow="1">
              <Button type="button" size="3" onClick={() => setEditOpen(true)}>
                <PencilIcon size={15} />
                {t("edit")}
              </Button>
            </Flex>
            <Flex asChild align="center" justify="center" gap="2" flexGrow="1">
              <Button
                type="button"
                size="3"
                variant="surface"
                color="red"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2Icon size={15} />
                {t("delete")}
              </Button>
            </Flex>
          </Flex>
        </Flex>
      </Flex>

      <Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
        <Dialog.Content maxWidth={movementFormDialogWidth}>
          {/* The form carries its own heading; the title stays for the a11y tree. */}
          <VisuallyHidden>
            <Dialog.Title>{t("editTitle")}</Dialog.Title>
          </VisuallyHidden>
          {/* Closing unmounts the content, so the form reseeds on each open. */}
          {editOpen && (
            <MovementForm
              mode="edit"
              options={options}
              movement={movement}
              causedByTransactionId={cause?.id ?? null}
              causeOptions={cause ? [cause] : []}
              onDone={() => setEditOpen(false)}
            />
          )}
        </Dialog.Content>
      </Dialog.Root>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteTitle")}
        description={t("deleteDescription")}
        confirmLabel={t("delete")}
        cancelLabel={tKey("common.cancel")}
        pending={remove.isPending}
        onConfirm={() => remove.execute({ transactionId: movement.id })}
      />
    </Flex>
  );
}

// One line of the trail: what it is on the left, what it says on the right —
// text or a figure alike, so a `Money` rides the same row as a plain string.
function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Flex align="center" justify="between" gap="4" py="3">
      <Text size="2" color="gray">
        {label}
      </Text>
      {typeof value === "string" ? (
        <Text size="2" weight="medium" align="right">
          {value}
        </Text>
      ) : (
        value
      )}
    </Flex>
  );
}
